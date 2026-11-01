import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import pc from 'picocolors'
import { CompileError, compile } from '../../compile/compile.js'
import { parseAgentList } from '../../compile/detect.js'
import { Session, stageInstall } from '../../compile/install.js'
import { renderAgents, renderHooks, renderNotes } from '../../compile/preview.js'
import { resolveLocal, SourceError } from '../../compile/source.js'
import { Workspace } from '../../compile/workspace.js'
import { AGENTS, type AgentId } from '../../core/ids.js'
import { type Command, fmt } from '../command.js'

export const exportCommand: Command = {
  name: 'export',
  summary:
    "Compile a capability into each agent's files without installing it (for authors and CI)",
  usage: 'sigil export <path> --agent <a,b|all> --out <dir> [--json]',
  options: { agent: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' } },
  async run({ positionals, values }, ctx) {
    const [path] = positionals
    if (!path || !values.agent || !values.out) {
      ctx.err(fmt.fail(`usage: ${exportCommand.usage}`))
      return 2
    }
    let agents: AgentId[]
    try {
      agents = values.agent === 'all' ? [...AGENTS] : parseAgentList(String(values.agent))
    } catch (e) {
      ctx.err(fmt.fail((e as Error).message))
      return 2
    }
    const outDir = resolve(ctx.cwd, String(values.out))
    const existing = await readdir(outDir).catch(() => [])
    if (existing.length) {
      ctx.err(fmt.fail(`${values.out} is not empty; export writes into an empty directory`))
      return 2
    }

    let compiled: ReturnType<typeof compile>
    try {
      const r = await resolveLocal(path, ctx.cwd, ctx.cwd)
      compiled = compile(r.input, agents)
    } catch (e) {
      if (e instanceof SourceError || e instanceof CompileError) {
        ctx.err(fmt.fail(e.message))
        return 1
      }
      throw e
    }

    // Same engine as install, against an empty directory and without a lockfile.
    const session = new Session(new Workspace(outDir), { sigil: 1, capabilities: {} }, false)
    const supported = compiled.results.some((r) => r.result.status === 'supported')
    if (supported) await stageInstall(session, { compiled, source: { kind: 'path', path } })
    const files = session.ws.changes().map((c) => c.path)

    if (values.json) {
      ctx.out(
        JSON.stringify(
          {
            id: compiled.capability.manifest.id,
            version: compiled.capability.manifest.version,
            digest: compiled.capability.digest,
            agents: compiled.results.map((r) =>
              r.result.status === 'supported'
                ? { agent: r.agent, status: 'supported', notes: r.result.notes }
                : { agent: r.agent, status: 'unsupported', reason: r.result.reason },
            ),
            files,
          },
          null,
          2,
        ),
      )
    } else {
      const m = compiled.capability.manifest
      ctx.out(`${pc.bold(`${m.id}@${m.version}`)}  ${pc.dim(compiled.capability.digest)}`)
      renderAgents(ctx.out, compiled)
      renderHooks(ctx.out, compiled)
      renderNotes(ctx.out, compiled)
      for (const f of files) ctx.out(`  ${pc.green('+')} ${f}`)
    }
    if (session.conflicts.length) {
      for (const c of session.conflicts) ctx.err(fmt.fail(c))
      return 1
    }
    if (!supported) {
      ctx.err(fmt.fail('none of the selected agents can load this capability'))
      return 1
    }
    await session.commit()
    if (!values.json) ctx.out(fmt.ok(`${files.length} files → ${values.out}`))
    return 0
  },
}
