import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PreparedImage } from './sandbox/types.js'
import type { Condition, PlanItem, RunRecord } from './types.js'

/**
 * Everything needed to reproduce a prove session. Written before the first run and completed at
 * the end; `--resume` refuses to continue a session whose inputs changed.
 */
export interface ReproManifest {
  sigil: 1
  /** Methodology version (spec/METHODOLOGY.md) that produced these runs. */
  method: string
  runId: string
  /** `local` unless produced by CI; evidence says which. */
  producedBy: 'local' | 'ci'
  /** `<runner>/<producedBy>`, e.g. `docker/ci` or `host/local`: how much to trust these runs. */
  label: string
  /** Set for host sessions: why their canary result is never a pass. */
  canaryNote?: string
  sigilVersion: string
  node: string
  platform: string
  command: string
  createdAt: string
  finishedAt?: string
  capability: { id: string; version: string; digest: string; path: string }
  agent: { id: string; version: string }
  model: { requested: string; reported: string[] }
  runner: 'docker' | 'host'
  auth: 'token' | 'keychain' | 'none'
  /** One per distinct task image, each with the agent installed. */
  images: PreparedImage[]
  suites: { suite: string; digest: string; tasks: string[] }[]
  conditions: Condition[]
  runs: number
  concurrency: number
  seed: number
  maxBudgetUsd?: number
  egress: { setup: string[]; agent: string[]; harnessDenied: string[] }
  plan: string[]
}

export class RunStore {
  constructor(readonly dir: string) {}

  static newId(slug: string, now = new Date()): string {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    return `${stamp}-${slug}-${randomBytes(2).toString('hex')}`
  }

  static at(root: string, runId: string): RunStore {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error(`invalid run id: ${runId}`)
    return new RunStore(join(root, 'lab-runs', runId))
  }

  async writeManifest(m: ReproManifest): Promise<void> {
    await atomicWrite(join(this.dir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`)
  }

  async readManifest(): Promise<ReproManifest> {
    try {
      return JSON.parse(await readFile(join(this.dir, 'manifest.json'), 'utf8')) as ReproManifest
    } catch {
      throw new Error(`no run manifest in ${this.dir}`)
    }
  }

  private base(item: PlanItem): string {
    return join(
      this.dir,
      'runs',
      ...item.suite.split('/'),
      item.task,
      `${item.condition}-${item.n}`,
    )
  }

  async writeRecord(r: RunRecord): Promise<void> {
    await atomicWrite(`${this.base(r)}.json`, `${JSON.stringify(r, null, 2)}\n`)
  }

  async writeTranscript(item: PlanItem, redacted: string): Promise<void> {
    await atomicWrite(`${this.base(item)}.stream.jsonl`, redacted)
  }

  async readRecords(): Promise<RunRecord[]> {
    const out: RunRecord[] = []
    async function walk(dir: string): Promise<void> {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.name.endsWith('.json'))
          out.push(JSON.parse(await readFile(p, 'utf8')) as RunRecord)
      }
    }
    await walk(join(this.dir, 'runs'))
    return out.sort((a, b) => a.key.localeCompare(b.key))
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, path)
}
