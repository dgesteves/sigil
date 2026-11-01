import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, relative, sep } from 'node:path'
import { compile } from '../compile/compile.js'
import { openSession, stageInstall } from '../compile/install.js'
import { LOCKFILE } from '../compile/lockfile.js'
import { verify } from '../compile/source.js'
import type { AgentId } from '../core/ids.js'
import type { InstallFile } from './agents/types.js'
import type { LabCapability } from './capability.js'
import { readPayload } from './install.js'

export class LabInstallError extends Error {}

/**
 * The files `sigil add` writes for one agent, computed by running the real install engine on a copy
 * of the task repo. The lab therefore measures exactly what users install, for every payload format:
 * skills, rules, commands, subagents, hooks, MCP servers and policies, including JSON merges into
 * settings files the task repo already has.
 *
 * Only new or changed files are returned. The lockfile is left out, because it would tell the agent
 * which condition it is in.
 */
export async function compiledInstallFiles(
  capability: LabCapability,
  agent: AgentId,
  repoDir: string,
): Promise<InstallFile[]> {
  const project = await mkdtemp(join(tmpdir(), 'sigil-lab-add-'))
  try {
    await cp(repoDir, project, { recursive: true })
    const before = await snapshot(project)

    const files = await readPayload(capability)
    const input = verify(
      { manifest: capability.manifest, digest: capability.digest, files },
      capability.files,
      capability.digest,
    )
    const compiled = compile(input, [agent], {
      exists: (p) => existsSync(join(project, ...p.split('/'))),
    })
    const result = compiled.results.find((r) => r.agent === agent)?.result
    if (!result || result.status !== 'supported') {
      throw new LabInstallError(
        `${agent} cannot load ${capability.manifest.id}: ${result?.status === 'unsupported' ? result.reason : 'no adapter'}`,
      )
    }

    const session = await openSession(project)
    await stageInstall(session, { compiled, source: { kind: 'path', path: '.' } })
    await session.finish()
    if (session.conflicts.length) {
      throw new LabInstallError(
        `installing ${capability.manifest.id} into the task repo conflicts: ${session.conflicts.join('; ')}`,
      )
    }
    await session.commit()

    const after = await snapshot(project)
    return (
      [...after]
        .filter(([path, content]) => path !== LOCKFILE && !before.get(path)?.equals(content))
        .map(([path, content]) => ({ path, content }))
        // Byte order, like the payload digest.
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    )
  } finally {
    await rm(project, { recursive: true, force: true })
  }
}

async function snapshot(root: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '.git') await walk(abs)
      } else if (entry.isFile()) {
        out.set(relative(root, abs).split(sep).join(posix.sep), await readFile(abs))
      }
    }
  }
  await walk(root)
  return out
}
