import pkg from '../../../package.json' with { type: 'json' }
import { DRIVERS, driverFor } from '../../lab/agents/registry.js'
import { AuthError, resolveAuth } from '../../lab/auth.js'
import { CapabilityError, resolveCapability } from '../../lab/capability.js'
import { ProveError, type ProveResult, prove as runProve } from '../../lab/prove.js'
import { findLabRoot, hostAgentVersion, openSession, resolveSuites } from '../../lab/session.js'
import { TaskError } from '../../lab/task.js'
import { type Command, type CommandContext, fmt } from '../command.js'

const USAGE =
  'sigil prove <capability-path|id> [--suite <suite>] [--runs 6] [--agent claude-code] [--model haiku] [--concurrency 2] [--host] [--auth-file <path>] [--resume <run-id>] [--canary-only] [--seed <n>] [--agent-version <x.y.z>] [--max-budget-usd <n>] [--no-evidence]'

export const prove: Command = {
  name: 'prove',
  summary: 'Measure a capability: sandboxed A/B runs with hidden tests, canaries and traces',
  usage: USAGE,
  options: {
    suite: { type: 'string', multiple: true },
    runs: { type: 'string' },
    agent: { type: 'string' },
    model: { type: 'string' },
    concurrency: { type: 'string' },
    host: { type: 'boolean' },
    'auth-file': { type: 'string' },
    resume: { type: 'string' },
    'canary-only': { type: 'boolean' },
    seed: { type: 'string' },
    'agent-version': { type: 'string' },
    'max-budget-usd': { type: 'string' },
    'no-evidence': { type: 'boolean' },
    keep: { type: 'boolean' },
  },
  async run({ positionals, values }, ctx) {
    const target = positionals[0]
    if (!target) {
      ctx.err(fmt.fail(`usage: ${USAGE}`))
      return 2
    }
    const root = await findLabRoot(ctx.cwd)
    if (!root) {
      ctx.err(fmt.fail('run inside a Sigil repo (no tasks/ or catalog/ directory found)'))
      return 2
    }
    const agentId = String(values.agent ?? 'claude-code')
    const driver = driverFor(agentId)
    if (!driver) {
      ctx.err(
        fmt.fail(
          `no lab driver for "${agentId}" yet; available: ${Object.keys(DRIVERS).join(', ')}`,
        ),
      )
      return 2
    }
    const ints = parseInts(values, { runs: 6, concurrency: 2 })
    if (typeof ints === 'string') {
      ctx.err(fmt.fail(ints))
      return 2
    }
    const host = values.host === true
    const budget =
      values['max-budget-usd'] === undefined ? undefined : Number(values['max-budget-usd'])
    if (budget !== undefined && !(budget > 0)) {
      ctx.err(fmt.fail('--max-budget-usd must be a positive number'))
      return 2
    }

    let session: Awaited<ReturnType<typeof openSession>> | undefined
    try {
      const capability = await resolveCapability(target, ctx.cwd, { root, host })
      const suiteNames = (values.suite as string[] | undefined) ?? capability.manifest.proof.suites
      if (suiteNames.length === 0) {
        ctx.err(fmt.fail(`${capability.manifest.id} lists no proof.suites; pass --suite <suite>`))
        return 2
      }
      const suites = await resolveSuites(suiteNames, ctx.cwd, root)
      const auth = await resolveAuth({
        runner: host ? 'host' : 'docker',
        ...(values['auth-file'] ? { authFile: String(values['auth-file']) } : {}),
      })
      if (host) {
        const login =
          auth.kind === 'keychain' ? 'your own Claude Code login (macOS keychain)' : 'your token'
        ctx.out(
          fmt.warn(
            `--host runs Claude Code on this machine with ${login}: first-party catalog content only`,
          ),
        )
      }
      const agentVersion = host
        ? undefined
        : ((values['agent-version'] as string | undefined) ?? (await hostAgentVersion(driver)))
      if (!host && !agentVersion) {
        ctx.err(
          fmt.fail(
            `pass --agent-version: ${driver.label} is not installed on this machine to pin its version`,
          ),
        )
        return 2
      }
      session = await openSession({
        host,
        auth,
        keep: values.keep === true,
        log: (l) => ctx.out(fmt.dim(l)),
      })
      const seed = values.seed === undefined ? undefined : Number(values.seed)
      const result = await runProve({
        root,
        capability,
        suites,
        driver,
        factory: session.factory,
        auth,
        model: String(values.model ?? 'haiku'),
        runs: ints.runs,
        concurrency: ints.concurrency,
        ...(seed !== undefined && Number.isInteger(seed) ? { seed } : {}),
        ...(values['canary-only'] ? { canaryOnly: true } : {}),
        ...(values.resume ? { resume: String(values.resume) } : {}),
        ...(agentVersion ? { agentVersion } : {}),
        ...(budget !== undefined ? { maxBudgetUsd: budget } : {}),
        writeEvidence: values['no-evidence'] !== true,
        sigilVersion: pkg.version,
        command: ['sigil', 'prove', ...process.argv.slice(3)].join(' '),
        log: (l) => ctx.out(l),
      })
      report(result, ctx)
      return result.withheld && values['no-evidence'] !== true ? 1 : 0
    } catch (e) {
      if (
        e instanceof AuthError ||
        e instanceof CapabilityError ||
        e instanceof TaskError ||
        e instanceof ProveError
      ) {
        ctx.err(fmt.fail(e.message))
        return 2
      }
      throw e
    } finally {
      await session?.cleanup()
    }
  },
}

function report(r: ProveResult, ctx: CommandContext): void {
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`
  ctx.out()
  for (const u of r.uplift) {
    const b = u.tasks.reduce((a, t) => [a[0]! + t.baseline.passed, a[1]! + t.baseline.runs], [0, 0])
    const t = u.tasks.reduce(
      (a, x) => [a[0]! + x.treatment.passed, a[1]! + x.treatment.runs],
      [0, 0],
    )
    ctx.out(
      `${fmt.bold(u.suite)}  baseline ${b[0]}/${b[1]}  treatment ${t[0]}/${t[1]}  delta ${pct(u.delta)}  95% CI [${pct(u.ci95[0])}, ${pct(u.ci95[1])}]  ${fmt.bold(u.verdict)}`,
    )
  }
  if (r.canary) {
    const line = `canary: ${r.canary.status} (${r.canary.runs} treatment runs, ${r.canary.events.length} events)`
    ctx.out(r.canary.status === 'pass' ? fmt.ok(line) : fmt.fail(line))
    for (const e of r.canary.events.slice(0, 20)) ctx.out(`    ${e.kind.padEnd(14)} ${e.detail}`)
  }
  const baselineEvents = r.records
    .filter((x) => x.condition === 'baseline')
    .flatMap((x) => x.canary)
  if (baselineEvents.length)
    ctx.out(
      fmt.dim(
        `  (the baseline tripped ${baselineEvents.length} canary events too: agent behaviour, not the capability)`,
      ),
    )
  const errors = r.records.filter((x) => x.status === 'error')
  if (errors.length)
    ctx.out(
      fmt.warn(`${errors.length} runs errored; re-run with --resume ${r.runId} to retry them`),
    )
  if (r.evidencePath) ctx.out(fmt.ok(`evidence → ${r.evidencePath} (${r.traces} traces)`))
  if (r.withheld) ctx.out(fmt.warn(`evidence not written: ${r.withheld}`))
  ctx.out(fmt.dim(`raw runs: ${r.dir}`))
}

function parseInts(
  values: Record<string, unknown>,
  defaults: { runs: number; concurrency: number },
) {
  const out = { ...defaults }
  for (const k of ['runs', 'concurrency'] as const) {
    if (values[k] === undefined) continue
    const n = Number(values[k])
    if (!Number.isInteger(n) || n < 1 || n > 100) return `--${k} must be an integer from 1 to 100`
    out[k] = n
  }
  return out
}
