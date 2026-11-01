import { stubDriver } from './agents/stub.js'
import { matcher } from './glob.js'
import { overlayFiles, runVerifier, SETUP_EGRESS } from './run.js'
import type { Sandbox, SandboxFactory } from './sandbox/types.js'
import type { LoadedTask } from './task.js'
import { tail } from './text.js'

export interface TaskCheck {
  suite: string
  task: string
  /** Verifier exit on the untouched repo; must be non-zero. */
  untouched?: number
  /** Verifier exits on repo + solution, one per repetition; all must be zero. */
  solution: number[]
  problems: string[]
  /** Tail of the first failing verifier output, to make a problem actionable. */
  output?: string
  ok: boolean
}

const NO_AGENT = stubDriver({ steps: [] })

/**
 * A task is valid when its verifier fails on the untouched repo, passes on the reference solution,
 * passes again on every repetition (no flakiness), and the solution leaves protected files alone.
 * Runs in the same sandbox as `sigil prove`, with registry access during setup only.
 */
export async function checkTask(
  task: LoadedTask,
  factory: SandboxFactory,
  opts: { repeat: number },
): Promise<TaskCheck> {
  const result: TaskCheck = {
    suite: task.suite,
    task: task.task.id,
    solution: [],
    problems: [],
    ok: false,
  }
  const problem = (p: string) => result.problems.push(p)

  if (/\b(sigil|skill)s?\b/i.test(task.task.prompt))
    problem('the prompt mentions Sigil or a skill; prompts must read like a real request')
  const repoFiles = await overlayFiles(task.repoDir)
  for (const glob of task.task.protected) {
    if (!repoFiles.some(matcher([glob])))
      problem(`protected glob matches nothing in repo/: ${glob}`)
  }
  if (!task.solutionDir) {
    problem('missing solution/ (a reference solution overlay is required)')
  } else {
    const isProtected = matcher(task.task.protected)
    const touched = (await overlayFiles(task.solutionDir)).filter(isProtected)
    if (touched.length) problem(`the solution modifies protected files: ${touched.join(', ')}`)
  }

  const image = await factory.prepare(task.task.image, NO_AGENT, undefined)

  const untouched = await withSandbox(factory, image, `${task.task.id}-untouched`, async (sb) => {
    const setup = await prepareRepo(sb, task, undefined)
    if (setup) return { setup }
    return { verify: await runVerifier(sb, task) }
  })
  if (untouched.setup) problem(`setup failed on the untouched repo: ${untouched.setup}`)
  else if (untouched.verify) {
    result.untouched = untouched.verify.exit
    if (untouched.verify.exit === 0) {
      problem('the verifier passes on the untouched repo, so it does not test the requested change')
      result.output ??= tail(untouched.verify.output, 1500)
    }
  }

  if (task.solutionDir) {
    const solutionDir = task.solutionDir
    const solved = await withSandbox(factory, image, `${task.task.id}-solution`, async (sb) => {
      const setup = await prepareRepo(sb, task, solutionDir)
      if (setup) return { setup, runs: [] as { exit: number; output: string }[] }
      const runs: { exit: number; output: string }[] = []
      for (let i = 0; i < opts.repeat; i++) runs.push(await runVerifier(sb, task))
      return { runs }
    })
    if (solved.setup) problem(`setup failed with the solution applied: ${solved.setup}`)
    result.solution = solved.runs.map((r) => r.exit)
    const failing = solved.runs.find((r) => r.exit !== 0)
    if (failing) {
      const passes = solved.runs.filter((r) => r.exit === 0).length
      problem(
        passes === 0
          ? 'the verifier fails on the reference solution'
          : `the verifier is flaky: ${passes}/${solved.runs.length} passes on the reference solution`,
      )
      result.output ??= tail(failing.output, 1500)
    }
  }

  result.ok = result.problems.length === 0
  return result
}

/** Copies the repo (and an overlay), commits it, and runs setup. Returns an error message or nothing. */
async function prepareRepo(
  sb: Sandbox,
  task: LoadedTask,
  overlay: string | undefined,
): Promise<string | undefined> {
  await sb.copyIn(task.repoDir, sb.workDir)
  await sb.setEgress('setup', SETUP_EGRESS)
  if (task.task.setup) {
    const r = await sb.sh(task.task.setup, { timeoutMs: 15 * 60_000 })
    if (r.code !== 0) return `exit ${r.code}: ${tail(r.stderr || r.stdout, 600)}`
  }
  // The solution stands in for the agent, so it lands after setup, exactly where an agent's
  // edits would.
  if (overlay) await sb.copyIn(overlay, sb.workDir)
  await sb.setEgress('verify', [])
  return undefined
}

async function withSandbox<T>(
  factory: SandboxFactory,
  image: Awaited<ReturnType<SandboxFactory['prepare']>>,
  name: string,
  fn: (sb: Sandbox) => Promise<T>,
): Promise<T> {
  const sb = await factory.create(image, name)
  try {
    return await fn(sb)
  } finally {
    await sb.dispose()
  }
}
