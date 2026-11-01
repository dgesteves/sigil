// A minimal browser for tests: one cookie jar per instance, redirects returned rather than
// followed, so each hop of a login can be inspected.
//
// `proxies` maps a public origin to the address of the app behind it, the way our load balancer
// does in production: TLS ends at the proxy, the app sees plain HTTP with `X-Forwarded-Proto` and
// `X-Forwarded-For`, and the Host header is the backend address (nginx's default).

export interface Hop {
  status: number
  location?: string
  headers: Headers
  body: string
}

interface StoredCookie {
  value: string
  expires?: number
}

export class Browser {
  readonly #jar = new Map<string, Map<string, StoredCookie>>()
  readonly #proxies: Record<string, string>

  constructor(proxies: Record<string, string> = {}) {
    this.#proxies = proxies
  }

  cookies(origin: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [name, c] of this.#jar.get(origin) ?? []) {
      if (c.expires === undefined || c.expires > Date.now()) out[name] = c.value
    }
    return out
  }

  setCookie(origin: string, name: string, value: string): void {
    this.#store(origin, [`${name}=${value}`])
  }

  get(url: string, headers: Record<string, string> = {}): Promise<Hop> {
    return this.request('GET', url, headers)
  }

  post(url: string, headers: Record<string, string> = {}, body?: string): Promise<Hop> {
    return this.request('POST', url, headers, body)
  }

  async request(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<Hop> {
    const target = new URL(url)
    const cookie = Object.entries(this.cookies(target.origin))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
    const backend = this.#proxies[target.origin]
    const sent = backend ? new URL(target.pathname + target.search, backend) : target
    const forwarded: Record<string, string> = backend
      ? { 'x-forwarded-proto': target.protocol.replace(':', ''), 'x-forwarded-for': '203.0.113.7' }
      : {}
    const res = await fetch(sent, {
      method,
      redirect: 'manual',
      headers: { ...forwarded, ...(cookie ? { cookie } : {}), ...headers },
      body,
    })
    this.#store(target.origin, res.headers.getSetCookie())
    const location = res.headers.get('location') ?? undefined
    return {
      status: res.status,
      location: location ? new URL(location, target).href : undefined,
      headers: res.headers,
      body: await res.text(),
    }
  }

  #store(origin: string, setCookies: string[]): void {
    let jar = this.#jar.get(origin)
    if (!jar) {
      jar = new Map()
      this.#jar.set(origin, jar)
    }
    for (const line of setCookies) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim())
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      let expires: number | undefined
      for (const attr of attrs) {
        const [k, v = ''] = attr.split('=')
        if (k.toLowerCase() === 'max-age') expires = Date.now() + Number(v) * 1000
        if (k.toLowerCase() === 'expires' && expires === undefined) expires = Date.parse(v)
      }
      if (expires !== undefined && expires <= Date.now()) jar.delete(name)
      else jar.set(name, { value, expires })
    }
  }
}
