import * as client from 'openid-client'
import type { OidcSettings } from './config.ts'

export type OidcConfig = () => Promise<client.Configuration>

/** Discovers the IdP on first use and caches the client configuration (failures are retried). */
export function oidcConfig(settings: OidcSettings): OidcConfig {
  let pending: Promise<client.Configuration> | undefined
  return () => {
    pending ??= client
      .discovery(
        new URL(settings.issuer),
        settings.clientId,
        settings.clientSecret,
        undefined,
        settings.allowHttpIssuer ? { execute: [client.allowInsecureRequests] } : undefined,
      )
      .catch((err: unknown) => {
        pending = undefined
        throw err
      })
    return pending
  }
}
