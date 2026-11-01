import pc from 'picocolors'
import { findProjectRoot } from '../../compile/context.js'
import { openSession, type Session, stageRemove } from '../../compile/install.js'
import { LockfileError } from '../../compile/lockfile.js'
import { renderChanges } from '../../compile/preview.js'
import { type Command, fmt } from '../command.js'

export const remove: Command = {
  name: 'remove',
  summary: 'Remove installed capabilities, restoring every file and setting they changed',
  usage: 'sigil remove <id> [...] [--dry-run] [--force]',
  options: { 'dry-run': { type: 'boolean' }, force: { type: 'boolean' } },
  async run({ positionals, values }, ctx) {
    if (positionals.length === 0) {
      ctx.err(fmt.fail(`usage: ${remove.usage}`))
      return 2
    }
    let session: Session
    try {
      session = await openSession(await findProjectRoot(ctx.cwd), Boolean(values.force))
    } catch (e) {
      if (e instanceof LockfileError) {
        ctx.err(fmt.fail(e.message))
        return 1
      }
      throw e
    }
    const removed: string[] = []
    for (const id of positionals) {
      // A collection id removes the members it installed.
      const ids = session.lock.capabilities[id]
        ? [id]
        : Object.entries(session.lock.capabilities)
            .filter(([, e]) => e.via === id)
            .map(([member]) => member)
      if (ids.length === 0) {
        session.conflict(`${id} is not installed`)
        continue
      }
      for (const x of ids) {
        await stageRemove(session, x)
        removed.push(x)
      }
    }
    const changes = await session.finish()
    ctx.out(pc.bold('Changes'))
    renderChanges(ctx.out, changes)
    for (const n of session.notes) ctx.out(`  ${pc.dim('i')} ${n}`)
    if (session.conflicts.length) {
      for (const c of session.conflicts) ctx.err(fmt.fail(c))
      ctx.err('Nothing was removed.')
      return 1
    }
    if (values['dry-run']) {
      ctx.out(fmt.dim('Dry run: nothing was written.'))
      return 0
    }
    await session.commit()
    ctx.out(fmt.ok(`Removed ${removed.join(', ')}`))
    return 0
  },
}
