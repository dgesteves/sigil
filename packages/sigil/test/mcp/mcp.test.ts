import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { FetchLike } from '../../src/compile/source.js'
import { digestDir } from '../../src/core/index.js'
import { Catalog } from '../../src/mcp/catalog.js'
import { PROTOCOL_VERSIONS, serve } from '../../src/mcp/server.js'
import {
  capDir,
  copyRepo,
  fakeGitHub,
  REGISTRY_URL,
  tempProject,
  tree,
} from '../compile/helpers.js'

const TAXONOMY = `sigil: 1
technologies:
  - { id: react, name: React, kind: framework, detect: { npm: [react] } }
  - { id: nextjs, name: Next.js, kind: framework, parent: react, detect: { npm: [next], files: [next.config.ts] } }
  - { id: typescript, name: TypeScript, kind: language, detect: { npm: [typescript], files: [tsconfig.json] } }
  - { id: go, name: Go, kind: language, detect: { files: [go.mod] } }
  - { id: express, name: Express, kind: framework, detect: { npm: [express] } }
`

/** The compile fixture catalog, tagged with technologies, plus a taxonomy: a local Sigil checkout. */
function checkout(): string {
  const repo = copyRepo()
  mkdirSync(join(repo, 'taxonomy'))
  writeFileSync(join(repo, 'taxonomy', 'technologies.yaml'), TAXONOMY)
  const tag = (path: string, techs: string) =>
    appendFileSync(join(repo, 'catalog', path, 'sigil.yaml'), `technologies: [${techs}]\n`)
  tag('skills/demo/hello-skill', 'nextjs')
  tag('rules/demo/ts-style', 'typescript')
  tag('agents/demo/reviewer', 'go')
  // Shares the project's language but is about a framework the project does not use.
  tag('mcp-servers/demo/files', 'typescript, express')
  return repo
}

/** A Next.js + TypeScript project that uses Claude Code, with a Go module hidden in node_modules. */
function project(): string {
  const root = tempProject()
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      dependencies: { next: '16.0.0', react: '19.0.0' },
      devDependencies: { typescript: '6' },
    }),
  )
  writeFileSync(join(root, 'tsconfig.json'), '{}')
  mkdirSync(join(root, '.claude'))
  mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'dep', 'go.mod'), 'module x\n')
  return root
}

const offline: FetchLike = () => Promise.reject(new Error('network is disabled in tests'))

interface Reply {
  id: number | string | null
  result?: Record<string, unknown> & {
    content?: { text: string }[]
    isError?: boolean
    structuredContent?: Record<string, unknown>
  }
  error?: { code: number; message: string }
}

async function talk(catalog: Catalog, messages: (object | string)[]): Promise<Reply[]> {
  const input = new PassThrough()
  const output = new PassThrough()
  let raw = ''
  output.on('data', (d: Buffer) => {
    raw += d.toString('utf8')
  })
  const done = serve(input, output, { catalog, version: '0.0.0-test', log: () => {} })
  for (const m of messages) input.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`)
  input.end()
  await done
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Reply)
}

let next = 1
const req = (method: string, params?: object) => ({ jsonrpc: '2.0', id: next++, method, params })
const callTool = (name: string, args: object = {}) => req('tools/call', { name, arguments: args })

async function tool(catalog: Catalog, name: string, args: object = {}) {
  const [r] = await talk(catalog, [callTool(name, args)])
  return r!.result!
}

describe('sigil mcp: protocol', () => {
  const catalog = new Catalog(tempProject(), checkout(), offline)

  it('negotiates the protocol version and introduces itself', async () => {
    const [known, unknown] = await talk(catalog, [
      req('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      }),
      req('initialize', {
        protocolVersion: '1999-01-01',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      }),
    ])
    expect(known!.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'sigil', version: '0.0.0-test' },
    })
    expect(known!.result!.instructions).toMatch(/only uplift "proven"/i)
    expect(unknown!.result!.protocolVersion).toBe(PROTOCOL_VERSIONS[0])
  })

  it('answers requests, ignores notifications and reports protocol errors', async () => {
    const replies = await talk(catalog, [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      req('ping'),
      req('resources/list'),
      '{ not json',
      req('tools/call', { name: 'nope', arguments: {} }),
    ])
    expect(replies).toHaveLength(4)
    expect(replies.find((r) => r.result)?.result).toEqual({})
    const codes = replies.filter((r) => r.error).map((r) => r.error!.code)
    expect(codes.sort()).toEqual([-32700, -32602, -32601].sort())
  })

  it('lists four read-only tools with JSON Schema inputs', async () => {
    const [r] = await talk(catalog, [req('tools/list')])
    const tools = r!.result!.tools as {
      name: string
      inputSchema: { type: string; properties: object }
      annotations: { readOnlyHint: boolean }
    }[]
    expect(tools.map((t) => t.name)).toEqual(['recommend', 'search', 'get', 'plan_install'])
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.annotations.readOnlyHint).toBe(true)
    }
    const search = tools.find((t) => t.name === 'search')!
    expect(Object.keys(search.inputSchema.properties)).toContain('proven_only')
  })

  it('returns bad arguments as a tool error the model can read', async () => {
    const r = await tool(catalog, 'search', { limit: 500 })
    expect(r.isError).toBe(true)
    expect(r.content![0]!.text).toMatch(/invalid arguments/)
  })
})

describe('sigil mcp: tools', () => {
  it('searches by words and filters, best match first', async () => {
    const catalog = new Catalog(tempProject(), checkout(), offline)
    const r = await tool(catalog, 'search', { query: 'hello skill' })
    const ids = (r.structuredContent!.results as { id: string }[]).map((x) => x.id)
    expect(ids[0]).toBe('demo/hello-skill')
    const rules = await tool(catalog, 'search', { type: 'rule' })
    expect(
      (rules.structuredContent!.results as { type: string }[]).every((x) => x.type === 'rule'),
    ).toBe(true)
    const none = await tool(catalog, 'search', { query: 'kubernetes' })
    expect(none.structuredContent!.total).toBe(0)
  })

  it('recommends capabilities for the detected stack and skips vendored files', async () => {
    const catalog = new Catalog(project(), checkout(), offline)
    const r = (await tool(catalog, 'recommend')).structuredContent!
    const stack = r.stack as { technologies: { id: string; confidence: number; source: string }[] }
    expect(stack.technologies.find((t) => t.id === 'nextjs')).toMatchObject({
      confidence: 1,
      source: 'package.json → next',
    })
    expect(stack.technologies.map((t) => t.id)).not.toContain('go')
    const results = r.results as { id: string; matched: string[] }[]
    expect(results.map((x) => [x.id, x.matched])).toEqual([
      ['demo/hello-skill', ['nextjs']],
      ['demo/ts-style', ['typescript']],
    ])
  })

  it('never reads outside the project', async () => {
    const catalog = new Catalog(project(), checkout(), offline)
    const r = await tool(catalog, 'recommend', { path: '../..' })
    expect(r.isError).toBe(true)
    expect(r.content![0]!.text).toMatch(/outside the project/)
  })

  it('explains a capability and says what its level means', async () => {
    const catalog = new Catalog(tempProject(), checkout(), offline)
    const r = (await tool(catalog, 'get', { id: 'demo/hello-skill' })).structuredContent!
    expect(r).toMatchObject({
      id: 'demo/hello-skill',
      level: 'submitted',
      uplift: 'untested',
      evidence: null,
      permissions: expect.stringContaining('files read'),
    })
    expect(r.levelMeaning).toMatch(/not validated/)
    const missing = await tool(catalog, 'get', { id: 'demo/missing' })
    expect(missing.isError).toBe(true)
    expect(missing.content![0]!.text).toMatch(/not in .*Use search/)
  })

  it('never suggests a revoked capability, but still explains it by id', async () => {
    const repo = checkout()
    const dir = join(repo, 'catalog', 'skills', 'demo', 'hello-skill')
    const at = '2026-11-01T12:00:00.000Z'
    const check = { status: 'pass', tool: { name: 'sigil', version: '0.0.0' }, at, findings: [] }
    writeFileSync(
      join(dir, 'evidence.json'),
      JSON.stringify({
        sigil: 1,
        capability: 'demo/hello-skill',
        version: '1.0.0',
        digest: (await digestDir(capDir('skills/demo/hello-skill'))).digest,
        generatedAt: at,
        structure: check,
        security: check,
        revoked: { at, reason: 'exfiltrated a honeytoken in the canary run' },
      }),
    )
    const catalog = new Catalog(project(), repo, offline)
    const found = await tool(catalog, 'search', { query: 'hello skill' })
    expect((found.structuredContent!.results as { id: string }[]).map((x) => x.id)).not.toContain(
      'demo/hello-skill',
    )
    const rec = await tool(catalog, 'recommend')
    expect((rec.structuredContent!.results as { id: string }[]).map((x) => x.id)).toEqual([
      'demo/ts-style',
    ])
    const got = (await tool(catalog, 'get', { id: 'demo/hello-skill' })).structuredContent!
    expect(got.level).toBe('revoked')
    expect(got.evidence).toMatchObject({
      revoked: { reason: expect.stringContaining('honeytoken') },
    })
  })

  it('plans an install with the real engine and writes nothing', async () => {
    const root = project()
    const repo = checkout()
    const before = tree(root)
    const catalog = new Catalog(root, repo, offline)
    const r = (await tool(catalog, 'plan_install', { id: 'demo/hello-skill' })).structuredContent!
    expect(r).toMatchObject({ agents: ['claude-code'], conflicts: [], written: false })
    expect(r.changes).toEqual(
      expect.arrayContaining([
        { path: '.claude/skills/hello-skill/SKILL.md', action: 'create', for: ['claude-code'] },
        { path: 'sigil.lock.json', action: 'create' },
      ]),
    )
    expect(r.command).toBe(`npx sigil add demo/hello-skill --agent claude-code --registry ${repo}`)
    expect(tree(root)).toEqual(before)
  })

  it('expands collections and asks for agents when the project has none', async () => {
    const catalog = new Catalog(tempProject(), checkout(), offline)
    const none = await tool(catalog, 'plan_install', { id: 'demo/hello-skill' })
    expect(none.isError).toBe(true)
    expect(none.content![0]!.text).toMatch(/No agent configuration/)
    const r = (
      await tool(catalog, 'plan_install', { id: 'demo/starter', agents: ['claude-code', 'codex'] })
    ).structuredContent!
    expect((r.capabilities as { id: string }[]).length).toBeGreaterThan(1)
  })

  it('reads the default registry and its taxonomy over https', async () => {
    const gh = await fakeGitHub({
      mutate: (reg) => {
        const caps = reg.capabilities as { manifest: { id: string; technologies: string[] } }[]
        caps.find((c) => c.manifest.id === 'demo/hello-skill')!.manifest.technologies = ['nextjs']
      },
    })
    const taxonomy = JSON.stringify([
      { id: 'react', name: 'React', kind: 'framework', detect: { npm: ['react'] } },
      {
        id: 'nextjs',
        name: 'Next.js',
        kind: 'framework',
        parent: 'react',
        detect: { npm: ['next'] },
      },
    ])
    const urls: string[] = []
    const fetchFn: FetchLike = async (url) => {
      urls.push(url)
      if (url === new URL('taxonomy.json', REGISTRY_URL).href)
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new TextEncoder().encode(taxonomy).buffer,
        }
      return gh.fetch(url)
    }
    const catalog = new Catalog(project(), undefined, fetchFn)
    const r = (await tool(catalog, 'recommend')).structuredContent!
    const [first] = r.results as { id: string; page: string }[]
    expect(first).toMatchObject({
      id: 'demo/hello-skill',
      page: 'https://sigil-lab.vercel.app/c/demo/hello-skill',
    })
    // The registry and taxonomy are fetched once per server, not once per call.
    await tool(catalog, 'search', { query: 'hello' })
    expect(urls.filter((u) => u === REGISTRY_URL)).toHaveLength(1)
  })
})
