#!/usr/bin/env node
// Checks that proving-ground tasks are valid before any agent runs them:
//   1. task.yaml matches the core Task schema and the task has repo/, verify/ and solution/.
//   2. The verifier FAILS on the untouched repo (otherwise the task measures nothing).
//   3. The verifier PASSES on repo + solution, --runs times in a row (otherwise it is flaky).
//
// Setup and verify run inside the task's declared image with Docker, the verifier with
// `--network none`, so "offline after setup" is enforced rather than assumed. `--local` runs the same
// steps on the host shell instead, for fast iteration only.
//
// Semantics (shared with the lab): solution/ and verify/ are overlays. Their files are copied over the
// repo root at the same relative paths, solution first, verify after the agent stops.
//
// Usage: node tasks/_tools/check-task.mjs <task-or-suite-dir>... [--runs 3] [--local] [--verbose]

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, matchesGlob, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(join(root, 'packages/sigil/package.json'))
const { parse } = require('yaml')
const { Task } = await import(join(root, 'packages/sigil/dist/core/index.js'))

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: 'string', default: '3' },
    local: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
})
const runs = Number(values.runs)

function findTasks(dir) {
  if (existsSync(join(dir, 'task.yaml'))) return [dir]
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .flatMap((e) => findTasks(join(dir, e.name)))
    .sort()
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : listFiles(abs, base)
    return [relative(base, abs)]
  })
}

const noModules = (src) => !src.split(/[\\/]/).includes('node_modules')

function sh(task, cwd, command, { network }) {
  const started = performance.now()
  const timeout = task.verify.timeoutSeconds * 1000
  const r = values.local
    ? spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', timeout })
    : spawnSync(
        'docker',
        [
          'run',
          '--rm',
          ...(network ? [] : ['--network', 'none']),
          '-v',
          `${cwd}:/work`,
          '-w',
          '/work',
          task.image,
          'sh',
          '-c',
          command,
        ],
        { encoding: 'utf8', timeout: network ? 600_000 : timeout + 30_000 },
      )
  const seconds = (performance.now() - started) / 1000
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`
  return { code: r.status ?? 1, seconds, output }
}

const tail = (s, n = 25) => s.trimEnd().split('\n').slice(-n).join('\n')

function checkTask(dir) {
  const problems = []
  const raw = parse(readFileSync(join(dir, 'task.yaml'), 'utf8'), {
    strict: true,
    uniqueKeys: true,
  })
  const parsed = Task.safeParse(raw)
  if (!parsed.success) {
    for (const i of parsed.error.issues)
      problems.push(`task.yaml ${i.path.join('.')}: ${i.message}`)
    return { problems }
  }
  const task = parsed.data
  const repo = join(dir, task.repo)
  const verify = join(dir, task.verify.dir)
  const solution = join(dir, 'solution')
  for (const [name, p] of [
    ['repo', repo],
    ['verify', verify],
    ['solution', solution],
  ]) {
    if (!existsSync(p) || !statSync(p).isDirectory()) problems.push(`missing ${name}/`)
  }
  if (problems.length) return { problems }
  if (/\b(sigil|skill)s?\b/i.test(task.prompt)) problems.push('prompt mentions a skill or Sigil')

  const repoFiles = listFiles(repo)
  for (const glob of task.protected) {
    if (!repoFiles.some((f) => matchesGlob(f, glob)))
      problems.push(`protected glob matches nothing: ${glob}`)
  }
  for (const f of listFiles(solution)) {
    if (task.protected.some((g) => matchesGlob(f, g)))
      problems.push(`solution edits a protected file: ${f}`)
  }

  const work = mkdtempSync(join(tmpdir(), `task-${task.id}-`))
  const result = { id: task.id, problems, runs: [] }
  try {
    const base = join(work, 'base')
    cpSync(repo, base, { recursive: true, filter: noModules })
    if (task.setup) {
      const s = sh(task, base, task.setup, { network: true })
      result.setupSeconds = s.seconds
      if (s.code !== 0) {
        problems.push(`setup failed (exit ${s.code}):\n${tail(s.output)}`)
        return result
      }
    }
    const conditions = [
      ['repo', false],
      ...Array.from({ length: runs }, (_, i) => [`solution#${i + 1}`, true]),
    ]
    for (const [label, withSolution] of conditions) {
      const cwd = join(work, label.replace('#', '-'))
      cpSync(base, cwd, { recursive: true, verbatimSymlinks: true })
      if (withSolution) cpSync(solution, cwd, { recursive: true, force: true })
      cpSync(verify, cwd, { recursive: true, force: true })
      const v = sh(task, cwd, task.verify.command, { network: false })
      const ok = withSolution ? v.code === 0 : v.code !== 0
      result.runs.push({ label, code: v.code, seconds: v.seconds, ok })
      if (!ok)
        problems.push(
          `${label}: verifier exited ${v.code}, expected ${withSolution ? '0' : 'non-zero'}\n${tail(v.output)}`,
        )
      else if (values.verbose)
        console.log(`--- ${task.id} ${label} (exit ${v.code})\n${tail(v.output)}`)
      if (v.seconds > 60) problems.push(`${label}: verifier took ${v.seconds.toFixed(1)}s (> 60s)`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return result
}

const dirs = (positionals.length ? positionals : ['tasks']).flatMap((p) => findTasks(resolve(p)))
let failed = 0
for (const dir of dirs) {
  const r = checkTask(dir)
  const name = relative(join(root, 'tasks'), dir)
  const timing = (r.runs ?? [])
    .map((x) => `${x.label}=${x.code}/${x.seconds.toFixed(1)}s`)
    .join(' ')
  const setup = r.setupSeconds === undefined ? '' : ` setup ${r.setupSeconds.toFixed(0)}s`
  if (r.problems.length) {
    failed++
    console.log(`FAIL ${name}${setup} ${timing}`)
    for (const p of r.problems) console.log(`  - ${p.replaceAll('\n', '\n    ')}`)
  } else {
    console.log(`ok   ${name}${setup} ${timing}`)
  }
}
console.log(
  `\n${dirs.length - failed}/${dirs.length} tasks valid${values.local ? ' (local, not in the image)' : ''}`,
)
process.exit(failed ? 1 : 0)
