import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { isDirectory } from '../../core/load.js'
import { findLabRoot, openSession } from '../../lab/session.js'
import { findTasks, TaskError } from '../../lab/task.js'
import { checkTask } from '../../lab/validity.js'
import { type Command, type CommandContext, fmt } from '../command.js'

const USAGE =
  'sigil task check <task-dir|suite-dir> [--host] [--repeat 3]\n       sigil task new <suite>/<task>'

export const task: Command = {
  name: 'task',
  summary: 'Check proving-ground tasks are valid, or scaffold a new one',
  usage: USAGE,
  options: { host: { type: 'boolean' }, repeat: { type: 'string' } },
  async run({ positionals, values }, ctx) {
    const [sub, target] = positionals
    if (sub === 'new' && target) return scaffold(target, ctx)
    if (sub === 'check' && target) return check(target, values, ctx)
    ctx.err(fmt.fail(`usage: ${USAGE}`))
    return 2
  },
}

async function check(
  target: string,
  values: Record<string, unknown>,
  ctx: CommandContext,
): Promise<number> {
  const repeat = values.repeat === undefined ? 3 : Number(values.repeat)
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
    ctx.err(fmt.fail('--repeat must be an integer from 1 to 20'))
    return 2
  }
  let tasks: Awaited<ReturnType<typeof findTasks>>
  try {
    // Suite names come from the target's own tasks/ ancestor, wherever the command runs.
    tasks = await findTasks(resolve(ctx.cwd, target))
  } catch (e) {
    if (e instanceof TaskError) {
      ctx.err(fmt.fail(e.message))
      return 2
    }
    throw e
  }
  // Task checks run only the task's own setup and verifier: no agent, no token.
  const session = await openSession({
    host: values.host === true,
    auth: { kind: 'none' },
    log: (l) => ctx.out(fmt.dim(l)),
  })
  let bad = 0
  try {
    for (const t of tasks) {
      const r = await checkTask(t, session.factory, { repeat })
      const label = `${r.suite}/${r.task}`
      const detail = fmt.dim(
        `untouched exit ${r.untouched ?? '?'}, solution exits [${r.solution.join(', ')}]`,
      )
      ctx.out(r.ok ? fmt.ok(`${label} ${detail}`) : fmt.fail(`${label} ${detail}`))
      for (const p of r.problems) ctx.out(`    ${p}`)
      if (r.output)
        for (const line of r.output.split('\n').slice(-15)) ctx.out(fmt.dim(`    | ${line}`))
      if (!r.ok) bad += 1
    }
  } finally {
    await session.cleanup()
  }
  ctx.out()
  ctx.out(`${tasks.length - bad}/${tasks.length} valid`)
  return bad ? 1 : 0
}

async function scaffold(target: string, ctx: CommandContext): Promise<number> {
  const m = /^((?:[a-z0-9_-]+\/)*[a-z0-9_-]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(target)
  if (!m) {
    ctx.err(
      fmt.fail(
        'expected <suite>/<task>, e.g. react/fix-stale-closure (lowercase, digits, hyphens)',
      ),
    )
    return 2
  }
  const [, suite, id] = m as unknown as [string, string, string]
  const root = (await findLabRoot(ctx.cwd)) ?? ctx.cwd
  const dir = join(root, 'tasks', suite, id)
  if (await isDirectory(dir)) {
    ctx.err(fmt.fail(`${relative(ctx.cwd, dir)} already exists`))
    return 1
  }
  const files: Record<string, string> = {
    'task.yaml': TASK_TEMPLATE.replace('{{id}}', id),
    'repo/package.json': `${JSON.stringify({ name: id, private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
    'repo/src/index.js':
      '// The starting state the agent sees. Leave the bug or the missing feature in place.\nexport function example() {\n  return 1\n}\n',
    'repo/test/index.test.js':
      "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { example } from '../src/index.js'\n\n// Visible tests the agent may run. Listed under `protected`, so editing them counts as tampering.\n// They run with the hidden tests too, so they must hold before and after the change.\ntest('example returns a number', () => assert.equal(typeof example(), 'number'))\n",
    'verify/test/hidden.test.js':
      "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { example } from '../src/index.js'\n\n// Hidden: verify/ is an overlay copied over the repo root after the agent stops, so this lands at\n// test/hidden.test.js. Must FAIL on repo/ and PASS on repo/ + solution/.\ntest('the requested change', () => assert.equal(example(), 2))\n",
    'solution/src/index.js':
      '// Reference solution: an overlay of files copied over repo/.\nexport function example() {\n  return 2\n}\n',
  }
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  ctx.out(fmt.ok(`created ${relative(ctx.cwd, dir) || '.'}`))
  ctx.out(fmt.dim(`next: edit the files, then run sigil task check ${relative(ctx.cwd, dir)}`))
  return 0
}

const TASK_TEMPLATE = `sigil: 1
id: {{id}}
title: Describe the change in a short sentence
# A real request a developer would make in this repo. Never mention the capability or Sigil.
prompt: >-
  Replace this with the request, written the way a developer would ask a colleague.
verify:
  # verify/ is an overlay: its files are copied over the repo root at the same paths after the
  # agent stops (verify/test/hidden.test.js -> test/hidden.test.js). Runs from the root; 0 = pass.
  command: node --test test/*.test.js
  timeoutSeconds: 120
# Files the agent must not modify (globs, relative to repo/). Edits count as tampering.
protected:
  - test/**
image: node:24-bookworm
# Runs before the timed window with package-registry access only (e.g. npm ci).
# setup: npm ci
timeoutSeconds: 600
tags: []
`
