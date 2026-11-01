import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { Manifest } from '../core/index.js'
import type { Unit } from './types.js'

const posixify = (p: string) => p.split(sep).join('/')
const SKILL_MD = /^skill\.md$/i
const CONFIG_FILE =
  /^(?:settings(?:\.local)?\.json|\.mcp\.json|mcp\.json|hooks(?:-[\w.]+)?\.json|gemini-extension\.json|plugin\.json|marketplace\.json|package\.json|config\.toml)$/i

/**
 * Turns a path into the units to scan. Works on a single capability (sigil.yaml present), a plain Agent
 * Skills folder (SKILL.md, no manifest) or a whole repo with many skills — one unit per skill, plus a
 * unit for agent config, policy, hook and MCP files that live outside any skill.
 */
export async function discover(absPath: string): Promise<Unit[]> {
  const st = await stat(absPath).catch(() => undefined)
  if (!st) return []
  if (st.isFile()) {
    return [
      {
        kind: 'file',
        name: basename(absPath),
        dir: dirname(absPath),
        files: [absPath],
        exclude: [],
        entries: SKILL_MD.test(basename(absPath)) ? [basename(absPath)] : [],
      },
    ]
  }

  // A manifest at the root: one capability (or plugin) unit over the whole directory.
  if (await exists(join(absPath, 'sigil.yaml'))) {
    return [await capabilityUnit(absPath)]
  }

  const skillDirs: string[] = []
  const configFiles: string[] = []
  await walk(absPath, 0, skillDirs, configFiles)

  if (skillDirs.length === 0 && configFiles.length === 0) {
    return [{ kind: 'directory', name: basename(absPath), dir: absPath, exclude: [], entries: [] }]
  }

  const units: Unit[] = []
  const skillSet = skillDirs.map((d) => resolve(d))
  for (const dir of skillDirs) {
    const nested = skillSet.filter(
      (o) => o !== resolve(dir) && o.startsWith(`${resolve(dir)}${sep}`),
    )
    const entry = await skillEntry(dir)
    units.push({
      kind: 'skill',
      name: skillName(absPath, dir),
      dir,
      exclude: nested,
      entries: entry ? [entry] : [],
    })
  }

  // Config, policy, hook and MCP files outside any skill: scanned as one unit per repo.
  const loose = configFiles.filter(
    (f) => !skillSet.some((d) => resolve(f).startsWith(`${d}${sep}`)),
  )
  if (loose.length) {
    units.push({
      kind: 'config',
      name: `${basename(absPath)} (agent config)`,
      dir: absPath,
      files: loose.sort(),
      exclude: [],
      entries: [],
    })
  }
  return units.sort((a, b) => a.name.localeCompare(b.name))
}

async function capabilityUnit(dir: string): Promise<Unit> {
  const unit: Unit = { kind: 'capability', name: basename(dir), dir, exclude: [], entries: [] }
  try {
    const raw = await readFile(join(dir, 'sigil.yaml'), 'utf8')
    const parsed = Manifest.safeParse(parseYaml(raw, { strict: false, uniqueKeys: false }))
    if (parsed.success) {
      unit.manifest = parsed.data
      unit.name = parsed.data.id
      unit.entries = [parsed.data.payload.entry]
    } else {
      unit.manifestError = parsed.error.issues[0]?.message ?? 'invalid sigil.yaml'
    }
  } catch (e) {
    unit.manifestError = (e as Error).message
  }
  return unit
}

async function walk(
  dir: string,
  depth: number,
  skillDirs: string[],
  configFiles: string[],
): Promise<void> {
  if (depth > 8) return
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      await walk(abs, depth + 1, skillDirs, configFiles)
    } else if (e.isFile()) {
      if (SKILL_MD.test(e.name)) skillDirs.push(dir)
      else if (CONFIG_FILE.test(e.name)) configFiles.push(abs)
    }
  }
}

async function skillEntry(dir: string): Promise<string | undefined> {
  for (const name of await readdir(dir).catch(() => [] as string[]))
    if (SKILL_MD.test(name)) return name
  return undefined
}

/** A readable name for a skill: its path from the repo root, or the skill's frontmatter name. */
function skillName(root: string, dir: string): string {
  const rel = posixify(relative(root, dir))
  return rel || basename(dir)
}

async function exists(p: string): Promise<boolean> {
  return Boolean(await stat(p).catch(() => undefined))
}
