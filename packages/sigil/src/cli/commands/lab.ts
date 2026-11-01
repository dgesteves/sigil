import { runSelfTest } from '../../lab/selftest.js'
import { openSession } from '../../lab/session.js'
import { type Command, fmt } from '../command.js'

export const lab: Command = {
  name: 'lab',
  summary: 'Self-test the lab sandbox: isolation, egress proxy, canaries, tamper and scoring',
  usage: 'sigil lab check [--host]',
  options: { host: { type: 'boolean' } },
  async run({ positionals, values }, ctx) {
    if (positionals[0] !== 'check') {
      ctx.err(fmt.fail('usage: sigil lab check [--host]'))
      return 2
    }
    const host = values.host === true
    ctx.out(
      fmt.dim(
        `running a scripted hostile agent through the ${host ? 'host' : 'Docker'} runner (no model, no token)`,
      ),
    )
    const session = await openSession({
      host,
      auth: { kind: 'none' },
      log: (l) => ctx.out(fmt.dim(l)),
    })
    try {
      const result = await runSelfTest(session.factory, (l) => ctx.out(fmt.dim(l)))
      ctx.out()
      for (const c of result.checks) {
        const line = `${c.name} ${fmt.dim(c.detail)}`
        ctx.out(
          c.ok
            ? fmt.ok(line)
            : c.notEnforced
              ? fmt.warn(`${line} ${fmt.dim('(not enforced by this runner)')}`)
              : fmt.fail(line),
        )
      }
      ctx.out()
      ctx.out(
        result.ok
          ? fmt.ok('the sandbox holds')
          : fmt.fail('the sandbox has gaps; do not trust runs from it'),
      )
      return result.ok ? 0 : 1
    } finally {
      await session.cleanup()
    }
  },
}
