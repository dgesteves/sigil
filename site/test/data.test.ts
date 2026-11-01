import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = { ...process.env }

describe('evidence source', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(process, 'cwd').mockReturnValue(
      new URL('..', import.meta.url).pathname.replace(/\/$/, ''),
    )
  })
  afterEach(() => {
    process.env = { ...env }
    vi.restoreAllMocks()
  })

  const load = async () => (await import('@/lib/server/data')).getData()

  it('refuses the demo fixture in production by path', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SIGIL_REGISTRY', 'fixtures/demo-registry.json')
    await expect(load()).rejects.toThrow(/refusing to read the demo fixture/)
  })

  it('refuses SIGIL_DATA=demo in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SIGIL_DATA', 'demo')
    await expect(load()).rejects.toThrow(/development only/)
  })

  it('reads the demo fixture in development, marked as demo', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const d = await load()
    expect(d.demo).toBe(true)
    expect(d.views.length).toBeGreaterThan(10)
    expect(d.views.every((v) => v.id.startsWith('demo/'))).toBe(true)
  })
})
