import type { OidcConfig } from './oidc.ts'
import type { SessionStore } from './session-store.ts'

/** The user has no usable session and must sign in again. */
export class NotAuthenticatedError extends Error {
  override name = 'NotAuthenticatedError'
}

/** The billing API answered with an unexpected status. */
export class UpstreamError extends Error {
  override name = 'UpstreamError'
  readonly status: number
  constructor(status: number, path: string) {
    super(`billing API answered ${status} for ${path}`)
    this.status = status
  }
}

export interface BillingApiOptions {
  baseUrl: string
  sessions: SessionStore
  oidc: OidcConfig
}

/** Calls the billing API on behalf of the user of a session. */
export class BillingApi {
  readonly #baseUrl: string
  readonly #sessions: SessionStore

  constructor(options: BillingApiOptions) {
    this.#baseUrl = options.baseUrl
    this.#sessions = options.sessions
  }

  async get<T>(sessionId: string, path: string): Promise<T> {
    const session = await this.#sessions.get(sessionId)
    if (!session) throw new NotAuthenticatedError('no session')

    const res = await fetch(new URL(path, this.#baseUrl), {
      headers: { authorization: `Bearer ${session.tokens.accessToken}`, accept: 'application/json' },
    })
    if (res.status === 401) throw new NotAuthenticatedError('the billing API rejected the access token')
    if (!res.ok) throw new UpstreamError(res.status, path)
    return (await res.json()) as T
  }
}
