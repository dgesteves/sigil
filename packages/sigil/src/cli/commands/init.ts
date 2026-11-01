import pc from 'picocolors'
import { lookup } from '../../compile/adapters.js'
import { AGENT_INFO } from '../../compile/agents.js'
import { findProjectRoot } from '../../compile/context.js'
import { detectAgents, parseAgentList } from '../../compile/detect.js'
import { openSession } from '../../compile/install.js'
import { LOCKFILE, LockfileError } from '../../compile/lockfile.js'
import { FORMAT_LABELS, INSTALL_FORMATS } from '../../compile/matrix.js'
import type { AgentId } from '../../core/ids.js'
import { type Command, fmt } from '../command.js'

export const init: Command = {
  name: 'init',
  summary: 'Detect the agents this project uses and record them as install targets',
  usage: 'sigil init [--agents a,b] [--dry-run]',
  options: { agents: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  async run({ values }, ctx) {
    const root = await findProjectRoot(ctx.cwd)
    const detected = await detectAgents(root)
    let agents: AgentId[]
    try {
      agents = values.agents ? parseAgentList(String(values.agents)) : detected.map((d) => d.agent)
    } catch (e) {
      ctx.err(fmt.fail((e as Error).message))
      return 2
    }
    if (agents.length === 0) {
      ctx.err(
        fmt.fail(
          'No agent configuration found. Name the agents you use: sigil init --agents claude-code,cursor',
        ),
      )
      return 1
    }

    ctx.out(`${pc.bold('Project')} ${root}`)
    for (const agent of agents) {
      const found = detected.find((d) => d.agent === agent)?.found
      ctx.out()
      ctx.out(
        `${pc.bold(AGENT_INFO[agent].name)} ${pc.dim(found ? `found ${found.join(', ')}` : 'chosen with --agents')}`,
      )
      if (AGENT_INFO[agent].status) ctx.out(`  ${pc.yellow('!')} ${AGENT_INFO[agent].status}`)
      for (const format of INSTALL_FORMATS) {
        const l = lookup(format, agent)
        const label = FORMAT_LABELS[format].padEnd(10)
        if (l.status === 'supported') ctx.out(`  ${pc.green('✓')} ${label} ${l.adapter.target}`)
        else
          ctx.out(
            `  ${pc.dim('–')} ${label} ${pc.dim(l.status === 'unsupported' ? l.gap.reason : 'not researched yet')}`,
          )
      }
    }
    ctx.out()

    if (values['dry-run']) {
      ctx.out(fmt.dim(`Dry run: ${LOCKFILE} was not written.`))
      return 0
    }
    try {
      const session = await openSession(root)
      session.lock.agents = agents
      await session.finish()
      await session.commit()
    } catch (e) {
      if (e instanceof LockfileError) {
        ctx.err(fmt.fail(e.message))
        return 1
      }
      throw e
    }
    ctx.out(fmt.ok(`${LOCKFILE}: sigil add now targets ${agents.join(', ')}`))
    return 0
  },
}
