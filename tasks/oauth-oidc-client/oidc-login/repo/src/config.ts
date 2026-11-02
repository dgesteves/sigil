export interface OidcSettings {
  /** Issuer identifier of our IdP realm. */
  issuer: string
  clientId: string
  clientSecret: string
  /** Registered at the IdP. It is our public URL: TLS ends at the load balancer. */
  redirectUri: string
  /** Registered at the IdP as an allowed post-logout redirect. */
  postLogoutRedirectUri: string
  /** Only for local development and tests against an IdP that is not behind TLS. */
  allowHttpIssuer?: boolean
}

export interface Config {
  port: number
  sessionSecret: string
  oidc: OidcSettings
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = env.PUBLIC_URL ?? 'https://partners.acme.test'
  return {
    port: Number(env.PORT ?? 3000),
    sessionSecret: required(env, 'SESSION_SECRET'),
    oidc: {
      issuer: required(env, 'OIDC_ISSUER'),
      clientId: env.OIDC_CLIENT_ID ?? 'partner-portal',
      clientSecret: required(env, 'OIDC_CLIENT_SECRET'),
      redirectUri: `${publicUrl}/auth/callback`,
      postLogoutRedirectUri: `${publicUrl}/`,
      allowHttpIssuer: env.OIDC_ALLOW_HTTP === 'true',
    },
  }
}
