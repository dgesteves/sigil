import * as client from 'openid-client'
import type { OidcConfig } from './oidc.ts'
import type { Session, SessionStore } from './session-store.ts'

/** The user has no usable session and must sign in again. */
export class NotAuthenticatedError extends Error {
  override name = 'NotAuthenticatedError'
}

/** The IdP could not refresh the tokens right now; the session is kept for a later attempt. */
export class IdpUnavailableError extends Error {
  override name = 'IdpUnavailableError'
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

/** Refresh this long before the access token expires, so it cannot expire in flight. */
const REFRESH_MARGIN_MS = 30_000

const needsRefresh = (session: Session) =>
  session.tokens.expiresAt - REFRESH_MARGIN_MS <= Date.now()

/** Calls the billing API on behalf of the user of a session. */
export class BillingApi {
  readonly #baseUrl: string
  readonly #sessions: SessionStore
  readonly #oidc: OidcConfig
  /**
   * One refresh in flight per session. The IdP rotates refresh tokens and revokes the login when a
   * used one comes back, so concurrent requests must share a single refresh.
   */
  readonly #refreshing = new Map<string, Promise<Session>>()

  constructor(options: BillingApiOptions) {
    this.#baseUrl = options.baseUrl
    this.#sessions = options.sessions
    this.#oidc = options.oidc
  }

  async get<T>(sessionId: string, path: string): Promise<T> {
    const session = await this.#currentSession(sessionId)
    const res = await fetch(new URL(path, this.#baseUrl), {
      headers: { authorization: `Bearer ${session.tokens.accessToken}`, accept: 'application/json' },
    })
    if (res.status === 401) throw new NotAuthenticatedError('the billing API rejected the access token')
    if (!res.ok) throw new UpstreamError(res.status, path)
    return (await res.json()) as T
  }

  async #currentSession(sessionId: string): Promise<Session> {
    const session = await this.#sessions.get(sessionId)
    if (!session) throw new NotAuthenticatedError('no session')
    if (!needsRefresh(session)) return session
    return this.#refreshOnce(sessionId)
  }

  #refreshOnce(sessionId: string): Promise<Session> {
    let pending = this.#refreshing.get(sessionId)
    if (!pending) {
      // Removed when settled, so a failed refresh (IdP outage) is retried by the next request.
      pending = this.#refresh(sessionId).finally(() => this.#refreshing.delete(sessionId))
      this.#refreshing.set(sessionId, pending)
    }
    return pending
  }

  async #refresh(sessionId: string): Promise<Session> {
    // Read again inside the single flight: a request that loaded the session before an earlier
    // refresh finished must not send the refresh token that refresh already rotated.
    const session = await this.#sessions.get(sessionId)
    if (!session) throw new NotAuthenticatedError('no session')
    if (!needsRefresh(session)) return session

    let tokens: Awaited<ReturnType<typeof client.refreshTokenGrant>>
    try {
      tokens = await client.refreshTokenGrant(await this.#oidc(), session.tokens.refreshToken)
    } catch (err) {
      if (err instanceof client.ResponseBodyError && err.error === 'invalid_grant') {
        await this.#sessions.delete(sessionId)
        throw new NotAuthenticatedError('the IdP rejected the refresh token', { cause: err })
      }
      throw new IdpUnavailableError('could not refresh the access token', { cause: err })
    }

    const refreshed: Session = {
      ...session,
      tokens: {
        accessToken: tokens.access_token,
        // Rotation: store the new refresh token. Keep the old one only if none was issued.
        refreshToken: tokens.refresh_token ?? session.tokens.refreshToken,
        idToken: tokens.id_token ?? session.tokens.idToken,
        expiresAt: Date.now() + (tokens.expiresIn() ?? 60) * 1000,
      },
    }
    await this.#sessions.set(sessionId, refreshed)
    return refreshed
  }
}
