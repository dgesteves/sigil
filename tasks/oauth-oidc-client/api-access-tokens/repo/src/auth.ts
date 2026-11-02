import type { NextFunction, Request, Response } from 'express'
import type { AuthConfig } from './config.ts'

/** The authenticated caller, available to handlers as `res.locals.principal`. */
export interface Principal {
  sub: string
  clientId?: string
  scopes: string[]
}

/**
 * Authenticates the caller from the bearer access token issued by our IdP.
 */
export function requireAuth(_config: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.get('authorization')
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    try {
      // TODO: verify the token instead of trusting whatever the client sends
      const [, payload] = header.slice('Bearer '.length).split('.')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      const principal: Principal = {
        sub: claims.sub,
        clientId: claims.client_id ?? claims.azp,
        scopes: String(claims.scope ?? '')
          .split(' ')
          .filter(Boolean),
      }
      res.locals.principal = principal
      next()
    } catch {
      res.status(401).json({ error: 'unauthorized' })
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
    res.status(403).json({ error: 'forbidden' })
  }
}
