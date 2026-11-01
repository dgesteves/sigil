import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildRegistry } from '../../core/index.js'
import { type Command, fmt } from '../command.js'
import { findRepoRoot } from './validate.js'

export const registry: Command = {
  name: 'registry',
  summary: 'Build registry.json from the catalog and its evidence',
  usage: 'sigil registry [--out registry.json] [--commit <sha>]',
  options: { out: { type: 'string' }, commit: { type: 'string' } },
  async run({ values }, ctx) {
    const root = await findRepoRoot(ctx.cwd)
    if (!root) {
      ctx.err(fmt.fail('run inside a Sigil repo (no catalog/ directory found)'))
      return 2
    }
    const { registry, rejected } = await buildRegistry(
      root,
      values.commit ? { commit: String(values.commit) } : {},
    )
    const out = resolve(ctx.cwd, String(values.out ?? 'registry.json'))
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, `${JSON.stringify(registry, null, 2)}\n`)
    ctx.out(fmt.ok(`${registry.capabilities.length} capabilities → ${out}`))
    for (const r of rejected) {
      ctx.out(fmt.warn(`${r.path}: ${r.findings.map((f) => f.message).join('; ')}`))
    }
    return 0
  },
}
