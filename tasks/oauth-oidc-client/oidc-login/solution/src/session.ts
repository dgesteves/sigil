import session from 'express-session'
import type { Config } from './config.ts'

export interface SessionUser {
  sub: string
  email?: string
  name?: string
}

/** What we keep between /login and /auth/callback. Used once, then deleted. */
export interface PendingLogin {
  codeVerifier: string
  state: string
  nonce: string
  startedAt: number
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser
    /** Kept for RP-initiated logout (id_token_hint). */
    idToken?: string
    pendingLogin?: PendingLogin
  }
}

export const SESSION_COOKIE = 'portal.sid'

export function sessions(config: Config) {
  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(config.oidc.redirectUri).protocol === 'https:',
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
}
