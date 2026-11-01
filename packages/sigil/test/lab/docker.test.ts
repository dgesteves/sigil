import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeCode } from '../../src/lab/agents/claude-code.js'
import { stubDriver } from '../../src/lab/agents/stub.js'
import {
  cleanupSession,
  DockerSandboxFactory,
  labDockerfile,
  labImageTag,
  PROXY_IMAGE,
  parseFileDump,
  pinImage,
} from '../../src/lab/sandbox/docker.js'
import { parseDockerDiff } from '../../src/lab/sandbox/docker-cli.js'
import { runSelfTest } from '../../src/lab/selftest.js'
import { loadTask } from '../../src/lab/task.js'
import { hashTree } from '../../src/lab/tree.js'
import { checkTask } from '../../src/lab/validity.js'

describe('docker image and diff helpers', () => {
  it('generates a pinned, content-addressed lab image', () => {
    const file = labDockerfile('node:24-bookworm', claudeCode.dockerLayers('2.1.316'))
    expect(file).toMatch(/^FROM node:24-bookworm\nUSER root\n/)
    expect(file).toContain('useradd --create-home --uid 10001')
    expect(file).toContain('@anthropic-ai/claude-code@2.1.316')
    expect(file).toMatch(/USER dev\n/)
    expect(labImageTag(file)).toMatch(/^sigil-lab:[0-9a-f]{16}$/)
    expect(labImageTag(file)).not.toBe(labImageTag(labDockerfile('node:24-bookworm', [])))
  })

  it('pins the proxy image by digest and parses the binary-safe file dump', () => {
    expect(PROXY_IMAGE).toMatch(/^node:24-bookworm@sha256:[0-9a-f]{64}$/)
    const bytes = Buffer.from([0, 1, 2, 255, 10, 13])
    const dump = `==SIGIL-FILE 755 /w/a b.sh\n${bytes.toString('base64')}\n==SIGIL-FILE 644 /w/c\nYWJj\n`
    const files = parseFileDump(dump)
    expect(files.get('/w/a b.sh')).toEqual({ content: bytes, mode: 0o755 })
    expect(files.get('/w/c')?.content.toString()).toBe('abc')
  })

  it('parses docker diff output', () => {
    const d = parseDockerDiff(
      'C /home\nA /home/dev/.aws\nA /home/dev/.aws/credentials\nD /etc/motd\nnoise\n',
    )
    expect([...d]).toEqual([
      ['/home', 'C'],
      ['/home/dev/.aws', 'A'],
      ['/home/dev/.aws/credentials', 'A'],
      ['/etc/motd', 'D'],
    ])
  })
})

/**
 * End to end through real containers: internal network, egress sidecar, non-root agent, canaries.
 * Opt-in because it needs a Docker daemon and pulls node:24-bookworm on first use:
 *   SIGIL_LAB_DOCKER=1 pnpm --dir packages/sigil test test/lab/docker.test.ts
 */
describe.skipIf(process.env.SIGIL_LAB_DOCKER !== '1')('docker sandbox (SIGIL_LAB_DOCKER=1)', () => {
  const session = `test-${process.pid}`
  const factory = new DockerSandboxFactory({ session })

  it('holds against a scripted hostile agent', async () => {
    try {
      const result = await runSelfTest(factory)
      const failed = result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)
      expect(failed).toEqual([])
    } finally {
      await cleanupSession(session)
    }
  }, 300_000)

  it('validates the sample task and hashes trees exactly like the host', async () => {
    try {
      const task = await loadTask(
        join(import.meta.dirname, '..', '..', '..', '..', 'tasks', '_sample', 'slugify-unicode'),
      )
      expect(await checkTask(task, factory, { repeat: 2 })).toMatchObject({
        ok: true,
        untouched: 1,
        solution: [0, 0],
      })
      const image = await factory.prepare(task.task.image, stubDriver({ steps: [] }), undefined)
      const sb = await factory.create(image, 'tree')
      try {
        await sb.copyIn(task.repoDir, sb.workDir)
        await sb.sh('git init -q . && ln -s /etc/hostname link')
        const inside = await sb.hashTree(sb.workDir)
        const host = await hashTree(task.repoDir)
        inside.delete('.git/config')
        expect(inside.get('link')).toBe('symlink')
        inside.delete('link')
        expect(new Map([...inside].filter(([p]) => !p.startsWith('.git/hooks/')))).toEqual(host)
        expect((await sb.facts()).mounts).toEqual([])
        const read = await sb.readFiles([
          `${sb.workDir}/test/slugify.test.js`,
          `${sb.workDir}/link`,
          `${sb.workDir}/nope`,
        ])
        expect([...read.keys()]).toEqual([`${sb.workDir}/test/slugify.test.js`])
        expect(read.get(`${sb.workDir}/test/slugify.test.js`)?.mode).toBe(0o644)
        expect(await pinImage('node:24-bookworm')).toBe(PROXY_IMAGE)
      } finally {
        await sb.dispose()
      }
    } finally {
      await cleanupSession(session)
    }
  }, 300_000)
})
