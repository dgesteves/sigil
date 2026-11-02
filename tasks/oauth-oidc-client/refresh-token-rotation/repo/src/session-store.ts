export interface TokenSet {
  accessToken: string
  refreshToken: string
  /** Needed for RP-initiated logout (id_token_hint). */
  idToken?: string
  /** When the access token expires, in epoch milliseconds. */
  expiresAt: number
}

export interface Session {
  user: { sub: string; email?: string; name?: string }
  tokens: TokenSet
  createdAt: number
}

/**
 * Server-side sessions, keyed by the opaque id in the `sid` cookie. Production uses the Redis
 * implementation from @acme/session-redis, which implements exactly this interface.
 */
export interface SessionStore {
  get(id: string): Promise<Session | undefined>
  set(id: string, session: Session): Promise<void>
  delete(id: string): Promise<void>
}

/** For local development and tests. Values are copied in and out, as they would be with Redis. */
export class MemorySessionStore implements SessionStore {
  readonly #data = new Map<string, string>()

  async get(id: string): Promise<Session | undefined> {
    await new Promise((resolve) => setImmediate(resolve))
    const raw = this.#data.get(id)
    return raw === undefined ? undefined : (JSON.parse(raw) as Session)
  }

  async set(id: string, session: Session): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve))
    this.#data.set(id, JSON.stringify(session))
  }

  async delete(id: string): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve))
    this.#data.delete(id)
  }
}
