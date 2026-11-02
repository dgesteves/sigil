import type { NextFunction, Request, Response } from 'express'
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import type { AuthConfig } from './config.ts'

/** The authenticated caller, available to handlers as `res.locals.principal`. */
export interface Principal {
  sub: string
  clientId?: string
  scopes: string[]
}

const REALM = 'shipments-api'

/** Resolves the IdP's jwks_uri from its discovery document once, then caches the key set. */
function issuerKeys(issuer: string): () => Promise<JWTVerifyGetKey> {
  let pending: Promise<JWTVerifyGetKey> | undefined
  return () => {
    pending ??= (async () => {
      const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`OIDC discovery failed with HTTP ${res.status}`)
      const metadata = (await res.json()) as { issuer?: unknown; jwks_uri?: unknown }
      if (metadata.issuer !== issuer) throw new Error('OIDC discovery returned another issuer')
      if (typeof metadata.jwks_uri !== 'string') throw new Error('OIDC discovery has no jwks_uri')
      // Cached, refetched when a token names an unknown kid (rate limited by jose's cooldown).
      return createRemoteJWKSet(new URL(metadata.jwks_uri))
    })().catch((err: unknown) => {
      pending = undefined
      throw err
    })
    return pending
  }
}

function challenge(res: Response, status: 401 | 403, params: Record<string, string> = {}): void {
  const attrs = Object.entries({ realm: REALM, ...params })
    .map(([k, v]) => `${k}="${v.replaceAll('"', "'")}"`)
    .join(', ')
  res.setHeader('WWW-Authenticate', `Bearer ${attrs}`)
  res.status(status).json({ error: params.error ?? 'unauthorized' })
}

/**
 * Authenticates the caller from the bearer access token issued by our IdP: an RFC 9068 JWT access
 * token, signature checked against the IdP's published keys, issuer, audience, type and lifetime
 * all enforced.
 */
export function requireAuth(config: AuthConfig) {
  const keys = issuerKeys(config.issuer)
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.get('authorization')
    const match = header?.match(/^Bearer +([A-Za-z0-9\-._~+/]+=*) *$/i)
    if (!header || !/^Bearer\b/i.test(header)) return challenge(res, 401)
    if (!match) return challenge(res, 401, { error: 'invalid_request' })

    let getKey: JWTVerifyGetKey
    try {
      getKey = await keys()
    } catch (err) {
      next(err)
      return
    }
    try {
      const { payload } = await jwtVerify(match[1], getKey, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256', 'ES256'],
        typ: 'at+jwt',
        requiredClaims: ['exp', 'iat', 'sub', 'client_id'],
      })
      if (typeof payload.sub !== 'string') throw new errors.JWTInvalid('sub must be a string')
      const principal: Principal = {
        sub: payload.sub,
        clientId: typeof payload.client_id === 'string' ? payload.client_id : undefined,
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
      }
      res.locals.principal = principal
      next()
    } catch (err) {
      if (err instanceof errors.JOSEError) {
        challenge(res, 401, { error: 'invalid_token', error_description: 'The access token is invalid' })
        return
      }
      next(err)
    }
  }
}

/** Lets the request through only if the access token was granted `scope`. */
export function requireScope(scope: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const principal = res.locals.principal as Principal | undefined
    if (principal?.scopes.includes(scope)) {
      next()
      return
    }
    challenge(res, 403, { error: 'insufficient_scope', scope })
  }
}
