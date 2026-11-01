import * as client from 'openid-client'
import type { OidcSettings } from './config.ts'

/**
 * Returns a getter for the IdP client configuration. Discovery runs on first use and is cached;
 * a failed discovery is retried on the next call instead of being cached.
 */
export function oidcConfiguration(settings: OidcSettings): () => Promise<client.Configuration> {
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
