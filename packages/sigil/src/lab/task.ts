import { readdir, readFile } from 'node:fs/promises'
import { basename, join, posix, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import { isDirectory } from '../core/load.js'
import { Task } from '../core/schema.js'

export interface LoadedTask {
  /** Absolute task directory. */
  dir: string
  /** Suite name: the task's parent directory relative to tasks/, e.g. `react/hooks` or `_sample`. */
  suite: string
  task: Task
  repoDir: string
  verifyDir: string
  /** Reference solution overlay. Optional at load time; `sigil task check` requires it. */
  solutionDir: string | undefined
}

export class TaskError extends Error {}

/** Loads one task directory. Throws TaskError with a message a task author can act on. */
export async function loadTask(dir: string, tasksRoot?: string): Promise<LoadedTask> {
  const abs = resolve(dir)
  let raw: string
  try {
    raw = await readFile(join(abs, 'task.yaml'), 'utf8')
  } catch {
    throw new TaskError(`${abs}: missing task.yaml`)
  }
  let data: unknown
  try {
    data = parse(raw, { strict: true, uniqueKeys: true })
  } catch (e) {
    throw new TaskError(`${abs}/task.yaml is not valid YAML: ${(e as Error).message}`)
  }
  const parsed = Task.safeParse(data)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new TaskError(`${abs}/task.yaml: ${issues.join('; ')}`)
  }
  const task = parsed.data
  if (task.id !== basename(abs)) {
    throw new TaskError(`${abs}: task id "${task.id}" must equal its directory name`)
  }
  const inside = (p: string, label: string) => {
    const full = resolve(abs, p)
    if (!full.startsWith(`${abs}${sep}`)) throw new TaskError(`${abs}: ${label} escapes the task`)
    return full
  }
  const repoDir = inside(task.repo, 'repo')
  const verifyDir = inside(task.verify.dir, 'verify.dir')
  if (!(await isDirectory(repoDir))) throw new TaskError(`${abs}: missing ${task.repo}/`)
  if (!(await isDirectory(verifyDir))) throw new TaskError(`${abs}: missing ${task.verify.dir}/`)
  const solution = join(abs, 'solution')
  const root = tasksRoot ? resolve(tasksRoot) : resolve(abs, '..', '..')
  return {
    dir: abs,
    suite: relative(root, resolve(abs, '..')).split(sep).join(posix.sep),
    task,
    repoDir,
    verifyDir,
    solutionDir: (await isDirectory(solution)) ? solution : undefined,
  }
}

/**
 * Resolves a task directory, a suite directory or a whole tasks/ tree into tasks, in path order.
 * A directory with task.yaml is one task (its repo/, verify/ and solution/ are never searched).
 * Children whose names start with `_` or `.` are skipped while searching (tools, samples), but can
 * always be named directly.
 */
export async function findTasks(target: string, tasksRoot?: string): Promise<LoadedTask[]> {
  const abs = resolve(target)
  if (!(await isDirectory(abs))) throw new TaskError(`not a directory: ${target}`)
  const root = tasksRoot ?? inferTasksRoot(abs)
  const out: LoadedTask[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    if (entries.some((e) => e.isFile() && e.name === 'task.yaml')) {
      out.push(await loadTask(dir, root))
      return
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        e.isDirectory() &&
        !e.name.startsWith('.') &&
        !e.name.startsWith('_') &&
        e.name !== 'node_modules'
      ) {
        await walk(join(dir, e.name))
      }
    }
  }
  await walk(abs)
  if (out.length === 0) throw new TaskError(`no tasks found in ${target} (looked for task.yaml)`)
  return out
}

/** The nearest ancestor named `tasks`, so suite names are stable wherever the command runs. */
export function inferTasksRoot(dir: string): string | undefined {
  const parts = resolve(dir).split(sep)
  const i = parts.lastIndexOf('tasks')
  return i > 0 ? parts.slice(0, i + 1).join(sep) : undefined
}
