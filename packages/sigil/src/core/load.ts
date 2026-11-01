import { access, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, posix, relative, sep } from 'node:path'
import { parse } from 'yaml'
import { DigestError, digestDir, type FileEntry } from './digest.js'
import { parseFrontmatter } from './frontmatter.js'
import type { CapabilityType } from './ids.js'
import { type Finding, Manifest } from './schema.js'

/** Directory under catalog/ for each type: catalog/<dir>/<namespace>/<slug>/sigil.yaml */
export const TYPE_DIRS: Record<CapabilityType, string> = {
  skill: 'skills',
  agent: 'agents',
  rule: 'rules',
  command: 'commands',
  workflow: 'workflows',
  hook: 'hooks',
  'mcp-server': 'mcp-servers',
  tool: 'tools',
  policy: 'policies',
  template: 'templates',
  evaluation: 'evaluations',
  collection: 'collections',
}

const MAX_FILE_BYTES = 1_000_000
const WARN_FILE_BYTES = 200_000
const SKILL_MAX_LINES = 500

export interface LoadedCapability {
  /** Absolute path of the capability directory. */
  dir: string
  manifest?: Manifest
  digest?: `sha256:${string}`
  files: FileEntry[]
  findings: Finding[]
}

export interface LoadOptions {
  /** Repo root, used to check catalog placement and proof suite paths. Optional for ad-hoc dirs. */
  root?: string
}

const err = (rule: string, message: string, file?: string, line?: number): Finding => ({
  rule,
  severity: 'high',
  message,
  ...(file ? { file } : {}),
  ...(line ? { line } : {}),
})
const warn = (rule: string, message: string, file?: string, line?: number): Finding => ({
  rule,
  severity: 'low',
  message,
  ...(file ? { file } : {}),
  ...(line ? { line } : {}),
})

/** Loads and structurally validates one capability directory. Never throws for content problems. */
export async function loadCapability(
  dir: string,
  opts: LoadOptions = {},
): Promise<LoadedCapability> {
  const findings: Finding[] = []
  const result: LoadedCapability = { dir, files: [], findings }

  let raw: string
  try {
    raw = await readFile(join(dir, 'sigil.yaml'), 'utf8')
  } catch {
    findings.push(err('SIG-STR-001', 'missing sigil.yaml', 'sigil.yaml'))
    return result
  }

  let data: unknown
  try {
    data = parse(raw, { strict: true, uniqueKeys: true })
  } catch (e) {
    findings.push(
      err('SIG-STR-002', `sigil.yaml is not valid YAML: ${(e as Error).message}`, 'sigil.yaml'),
    )
    return result
  }

  const parsed = Manifest.safeParse(data)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const at = issue.path.length ? issue.path.join('.') : '(root)'
      findings.push(err('SIG-STR-003', `${at}: ${issue.message}`, 'sigil.yaml'))
    }
    return result
  }
  const manifest = parsed.data
  result.manifest = manifest
  const slug = manifest.id.split('/')[1]!
  const namespace = manifest.id.split('/')[0]!

  if (basename(dir) !== slug) {
    findings.push(
      err('SIG-STR-005', `directory name "${basename(dir)}" must equal the id's slug "${slug}"`),
    )
  }

  if (opts.root) {
    const rel = relative(opts.root, dir).split(sep).join(posix.sep)
    const expected = `catalog/${TYPE_DIRS[manifest.type]}/${namespace}/${slug}`
    if (rel.startsWith('catalog/') && rel !== expected) {
      findings.push(
        err('SIG-STR-016', `a ${manifest.type} with id ${manifest.id} belongs at ${expected}`),
      )
    }
    for (const suite of manifest.proof.suites) {
      if (!(await exists(join(opts.root, 'tasks', suite)))) {
        findings.push(
          warn('SIG-STR-012', `proof suite tasks/${suite} does not exist`, 'sigil.yaml'),
        )
      }
    }
  }

  if (manifest.source) {
    // External capabilities: the payload lives upstream at a pinned commit. Only metadata is hosted here.
    const local = (await readdir(dir)).filter(
      (f) => f !== 'sigil.yaml' && f !== 'evidence.json' && f !== '.DS_Store',
    )
    if (local.length > 0) {
      findings.push(
        err('SIG-STR-011', `external capabilities host only sigil.yaml; found ${local.join(', ')}`),
      )
    }
    return result
  }

  try {
    const { digest, files } = await digestDir(dir)
    result.digest = digest
    result.files = files
  } catch (e) {
    findings.push(err('SIG-STR-013', (e as Error).message))
    if (e instanceof DigestError) return result
    throw e
  }

  for (const f of result.files) {
    if (f.bytes > MAX_FILE_BYTES)
      findings.push(err('SIG-STR-015', `file is larger than 1 MB (${f.bytes} bytes)`, f.path))
    else if (f.bytes > WARN_FILE_BYTES)
      findings.push(warn('SIG-STR-015', `large file (${f.bytes} bytes) costs context`, f.path))
  }

  const entry = manifest.payload.entry
  if (!result.files.some((f) => f.path === entry)) {
    findings.push(err('SIG-STR-004', `payload entry "${entry}" does not exist`, 'sigil.yaml'))
    return result
  }

  await checkFormat(dir, manifest, slug, result.files, findings)
  return result
}

async function checkFormat(
  dir: string,
  manifest: Manifest,
  slug: string,
  files: FileEntry[],
  findings: Finding[],
): Promise<void> {
  const entry = manifest.payload.entry
  const text = await readFile(join(dir, entry), 'utf8')

  if (manifest.payload.format === 'agent-skill') {
    if (entry !== 'SKILL.md')
      findings.push(
        err('SIG-STR-006', 'an agent-skill payload entry must be SKILL.md', 'sigil.yaml'),
      )
    let fm: ReturnType<typeof parseFrontmatter>
    try {
      fm = parseFrontmatter(text)
    } catch (e) {
      findings.push(
        err('SIG-STR-006', `invalid SKILL.md frontmatter: ${(e as Error).message}`, entry, 1),
      )
      return
    }
    if (!fm) {
      findings.push(err('SIG-STR-006', 'SKILL.md must start with YAML frontmatter', entry, 1))
      return
    }
    const name = fm.data.name
    const description = fm.data.description
    if (name !== slug)
      findings.push(
        err(
          'SIG-STR-007',
          `SKILL.md name must be "${slug}" (got ${JSON.stringify(name)})`,
          entry,
          2,
        ),
      )
    if (typeof description !== 'string' || description.trim().length === 0) {
      findings.push(err('SIG-STR-008', 'SKILL.md description is required', entry, 2))
    } else if (description.length > 1024) {
      findings.push(
        err(
          'SIG-STR-008',
          `SKILL.md description is ${description.length} characters; the limit is 1024`,
          entry,
          2,
        ),
      )
    } else if (description.length < 60) {
      findings.push(
        warn(
          'SIG-STR-008',
          'short descriptions rarely trigger: say what it does and when to use it',
          entry,
          2,
        ),
      )
    }
    const allowed = new Set([
      'name',
      'description',
      'license',
      'compatibility',
      'metadata',
      'allowed-tools',
    ])
    for (const key of Object.keys(fm.data)) {
      if (!allowed.has(key))
        findings.push(
          warn('SIG-STR-017', `"${key}" is not an Agent Skills frontmatter field`, entry),
        )
    }
    const lines = text.split('\n').length
    if (lines > SKILL_MAX_LINES) {
      findings.push(
        warn(
          'SIG-STR-009',
          `SKILL.md has ${lines} lines; keep it under ${SKILL_MAX_LINES} and move detail to references/`,
          entry,
        ),
      )
    }
  }

  // Every relative markdown link in a markdown payload must resolve inside the capability.
  if (entry.endsWith('.md')) {
    const known = new Set(files.map((f) => f.path))
    const base = dirname(entry) === '.' ? '' : `${dirname(entry)}/`
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
        const target = m[1]!
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue
        const resolved = posix.normalize(base + target)
        if (resolved.startsWith('..')) {
          findings.push(err('SIG-STR-010', `link escapes the capability: ${target}`, entry, i + 1))
        } else if (!known.has(resolved) && !files.some((f) => f.path.startsWith(`${resolved}/`))) {
          findings.push(err('SIG-STR-010', `broken link: ${target}`, entry, i + 1))
        }
      }
    })
  }
}

/** Finds every capability directory (one containing sigil.yaml) under `root/catalog`. */
export async function findCapabilities(catalogDir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name === 'sigil.yaml')) {
      out.push(dir)
      return
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        await walk(join(dir, e.name), depth + 1)
    }
  }
  await walk(catalogDir, 0)
  return out.sort()
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
