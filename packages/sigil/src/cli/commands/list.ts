import pc from 'picocolors'
import { findProjectRoot } from '../../compile/context.js'
import { inspect } from '../../compile/install.js'
import { LOCKFILE, LockfileError, readLock } from '../../compile/lockfile.js'
import { Workspace } from '../../compile/workspace.js'
import { type Command, fmt } from '../command.js'

const STATE = {
  ok: pc.green('ok'),
  modified: pc.yellow('modified'),
  missing: pc.red('missing'),
  preexisting: pc.dim('kept'),
}

export const list: Command = {
  name: 'list',
  summary: 'Show installed capabilities, their digests and agents, and any drift since install',
  usage: 'sigil list [--json]',
  options: { json: { type: 'boolean' } },
  async run({ values }, ctx) {
    const ws = new Workspace(await findProjectRoot(ctx.cwd))
    let lock: Awaited<ReturnType<typeof readLock>>
    try {
      lock = await readLock(ws)
    } catch (e) {
      if (e instanceof LockfileError) {
        ctx.err(fmt.fail(e.message))
        return 1
      }
      throw e
    }
    const statuses = lock ? await inspect(ws, lock) : []
    if (values.json) {
      ctx.out(
        JSON.stringify(
          statuses.map((s) => ({
            id: s.id,
            version: s.entry.version,
            digest: s.entry.digest,
            agents: s.entry.agents,
            level: s.entry.level ?? null,
            uplift: s.entry.uplift ?? null,
            drift: s.items.filter((i) => i.state === 'modified' || i.state === 'missing'),
          })),
          null,
          2,
        ),
      )
      return 0
    }
    if (statuses.length === 0) {
      ctx.out(`Nothing installed${lock ? '' : ` (no ${LOCKFILE})`}.`)
      return 0
    }
    for (const s of statuses) {
      const drift = s.items.filter((i) => i.state === 'modified' || i.state === 'missing')
      const head = `${pc.bold(`${s.id}@${s.entry.version}`)}  ${pc.dim(s.entry.digest.slice(0, 19))}  ${s.entry.agents.join(', ')}`
      ctx.out(
        drift.length
          ? fmt.warn(`${head}  ${pc.yellow(`${drift.length} changed since install`)}`)
          : fmt.ok(head),
      )
      for (const i of s.items) {
        if (i.state === 'ok') continue
        ctx.out(`    ${STATE[i.state]}  ${i.path}${i.what === 'file' ? '' : pc.dim(`  ${i.what}`)}`)
      }
    }
    return 0
  },
}
