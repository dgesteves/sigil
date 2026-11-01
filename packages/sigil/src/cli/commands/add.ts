import { existsSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import { CompileError, compile } from '../../compile/compile.js'
import { confirmOf, fetchOf, findProjectRoot, nowOf } from '../../compile/context.js'
import { detectAgents, parseAgentList } from '../../compile/detect.js'
import { openSession, type Session, stageInstall } from '../../compile/install.js'
import { LockfileError } from '../../compile/lockfile.js'
import {
  renderAgents,
  renderChanges,
  renderHeader,
  renderHooks,
  renderNotes,
} from '../../compile/preview.js'
import {
  isPathSpec,
  openRegistry,
  type RegistryHandle,
  type Resolved,
  resolveFromRegistry,
  resolveLocal,
  SourceError,
} from '../../compile/source.js'
import type { AgentId } from '../../core/ids.js'
import { type Command, type CommandContext, fmt } from '../command.js'

export const add: Command = {
  name: 'add',
  summary: 'Install capabilities into the agents this project uses',
  usage:
    'sigil add <id|path> [...] [--agent a,b] [--registry <url|path>] [--dry-run] [--yes] [--force]',
  options: {
    agent: { type: 'string' },
    registry: { type: 'string' },
    'dry-run': { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
    force: { type: 'boolean' },
  },
  async run({ positionals, values }, ctx) {
    if (positionals.length === 0) {
      ctx.err(fmt.fail(`usage: ${add.usage}`))
      return 2
    }
    const root = await findProjectRoot(ctx.cwd)
    let session: Session
    try {
      session = await openSession(root, Boolean(values.force))
    } catch (e) {
      if (e instanceof LockfileError) {
        ctx.err(fmt.fail(e.message))
        return 1
      }
      throw e
    }

    let agents: AgentId[]
    try {
      agents = values.agent
        ? parseAgentList(String(values.agent))
        : (session.lock.agents ?? (await detectAgents(root)).map((d) => d.agent))
    } catch (e) {
      ctx.err(fmt.fail((e as Error).message))
      return 2
    }
    if (agents.length === 0) {
      ctx.err(
        fmt.fail(
          'No agent configuration found in this project. Pass --agent claude-code,cursor or run sigil init --agents ...',
        ),
      )
      return 2
    }

    let resolved: { r: Resolved; spec: string; via?: string }[]
    try {
      resolved = await resolveAll(positionals, ctx, root, values.registry as string | undefined)
    } catch (e) {
      if (e instanceof SourceError) {
        ctx.err(fmt.fail(e.message))
        return 1
      }
      throw e
    }

    const exists = (p: string) => existsSync(join(root, p))
    const compiled = []
    for (const { r, spec, via } of resolved) {
      let c: ReturnType<typeof compile>
      try {
        c = compile(r.input, agents, { exists })
      } catch (e) {
        if (!(e instanceof CompileError)) throw e
        ctx.err(fmt.fail(e.message))
        return 1
      }
      compiled.push(c)
      const id = r.input.manifest.id
      const source =
        r.source.kind === 'path'
          ? `local path ${spec}`
          : `${r.source.registry}${r.source.commit ? ` @ ${r.source.commit.slice(0, 12)}` : ''}`
      ctx.out()
      renderHeader(ctx.out, c, {
        ...(r.entry ? { level: r.entry.level, uplift: r.entry.uplift } : {}),
        source,
      })
      if (r.entry?.level === 'submitted')
        ctx.out(
          fmt.warn(
            pc.yellow(
              pc.bold(
                `${id} is SUBMITTED: Sigil has not validated this exact content. Read what it installs before you continue.`,
              ),
            ),
          ),
        )
      if (r.entry?.uplift === 'harmful')
        ctx.out(
          fmt.warn(
            pc.red(pc.bold(`${id} made agents measurably worse in Sigil's lab (uplift: harmful).`)),
          ),
        )
      if (!r.entry)
        ctx.out(fmt.warn('Installed from a local path: no registry checks apply to this content.'))
      renderAgents(ctx.out, c)
      renderHooks(ctx.out, c)
      renderNotes(ctx.out, c)
      if (!c.results.some((x) => x.result.status === 'supported')) {
        session.conflict(`${id}: none of the selected agents can load it`)
        continue
      }
      await stageInstall(session, {
        compiled: c,
        source: r.source,
        ...(r.entry ? { level: r.entry.level, uplift: r.entry.uplift } : {}),
        ...(via ? { via } : {}),
        now: nowOf(ctx),
      })
    }

    const changes = await session.finish()
    ctx.out()
    ctx.out(pc.bold('Changes'))
    renderChanges(ctx.out, changes)
    for (const c of compiled) renderChanges(ctx.out, [], c)
    for (const n of session.notes) ctx.out(`  ${pc.dim('i')} ${n}`)
    if (session.conflicts.length) {
      ctx.out()
      for (const c of session.conflicts) ctx.err(fmt.fail(c))
      ctx.err('Nothing was installed.')
      return 1
    }
    if (values['dry-run']) {
      ctx.out()
      ctx.out(fmt.dim('Dry run: nothing was written.'))
      return 0
    }
    if (!values.yes && !(await confirmOf(ctx, 'Install?'))) {
      ctx.err('Not installed. Re-run with --yes to install without asking.')
      return 1
    }
    await session.commit()
    ctx.out(fmt.ok(`Installed ${compiled.map((c) => c.capability.manifest.id).join(', ')}`))
    return 0
  },
}

/** Resolves every spec; collections expand into their members, each installed on its own. */
async function resolveAll(
  specs: string[],
  ctx: CommandContext,
  root: string,
  registry: string | undefined,
) {
  let handle: RegistryHandle | undefined
  const open = async () => {
    handle ??= await openRegistry(registry, ctx.cwd, fetchOf(ctx))
    return handle
  }
  const queue: { spec: string; via?: string }[] = specs.map((spec) => ({ spec }))
  const seen = new Set<string>()
  const out: { r: Resolved; spec: string; via?: string }[] = []
  for (const { spec, via } of queue) {
    const r = isPathSpec(spec)
      ? await resolveLocal(spec, ctx.cwd, root)
      : await resolveFromRegistry(await open(), spec)
    const id = r.input.manifest.id
    if (seen.has(id)) continue
    seen.add(id)
    if (r.input.manifest.payload.format === 'bundle') {
      ctx.out(fmt.dim(`${id} is a collection of ${r.input.manifest.includes.join(', ')}`))
      for (const member of r.input.manifest.includes) queue.push({ spec: member, via: id })
      continue
    }
    out.push({ r, spec, ...(via ? { via } : {}) })
  }
  return out
}
