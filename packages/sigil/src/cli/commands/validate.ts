import { resolve } from 'node:path'
import pc from 'picocolors'
import { findCapabilities, isDirectory, loadCapability } from '../../core/index.js'
import type { Finding } from '../../core/schema.js'
import { type Command, fmt } from '../command.js'

const SEVERITY_COLOR: Record<Finding['severity'], (s: string) => string> = {
  critical: pc.red,
  high: pc.red,
  medium: pc.yellow,
  low: pc.dim,
  info: pc.dim,
}

export const validate: Command = {
  name: 'validate',
  summary: 'Check capabilities against the Sigil spec and the Agent Skills format',
  usage: 'sigil validate [path...] [--json]',
  options: { json: { type: 'boolean' } },
  async run({ positionals, values }, ctx) {
    const targets = positionals.length ? positionals : ['catalog']
    const dirs: string[] = []
    for (const t of targets) {
      const abs = resolve(ctx.cwd, t)
      if (!(await isDirectory(abs))) {
        ctx.err(fmt.fail(`not a directory: ${t}`))
        return 2
      }
      const found = await findCapabilities(abs)
      dirs.push(...found)
    }
    if (dirs.length === 0) {
      ctx.err(fmt.fail('no capabilities found (looked for sigil.yaml)'))
      return 2
    }

    const root = await findRepoRoot(ctx.cwd)
    const results = await Promise.all(dirs.map((d) => loadCapability(d, root ? { root } : {})))
    const failing = results.filter((r) =>
      r.findings.some((f) => f.severity === 'high' || f.severity === 'critical'),
    )

    if (values.json) {
      ctx.out(
        JSON.stringify(
          results.map((r) => ({
            dir: r.dir,
            id: r.manifest?.id,
            digest: r.digest,
            findings: r.findings,
          })),
          null,
          2,
        ),
      )
      return failing.length ? 1 : 0
    }

    for (const r of results) {
      const label = r.manifest ? `${r.manifest.id}@${r.manifest.version}` : r.dir
      const bad = failing.includes(r)
      ctx.out(
        bad ? fmt.fail(label) : fmt.ok(`${label} ${fmt.dim(r.digest?.slice(0, 19) ?? 'external')}`),
      )
      for (const f of r.findings) {
        const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''} ` : ''
        ctx.out(
          `    ${SEVERITY_COLOR[f.severity](f.severity.padEnd(8))} ${fmt.dim(f.rule)} ${where}${f.message}`,
        )
      }
    }
    ctx.out()
    ctx.out(`${results.length - failing.length}/${results.length} valid`)
    return failing.length ? 1 : 0
  },
}

/** Nearest ancestor with a catalog/ directory, so placement and proof-suite checks can run. */
export async function findRepoRoot(from: string): Promise<string | undefined> {
  let dir = resolve(from)
  for (;;) {
    if (await isDirectory(resolve(dir, 'catalog'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return undefined
    dir = parent
  }
}
