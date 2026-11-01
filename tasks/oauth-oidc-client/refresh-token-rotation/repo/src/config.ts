export interface OidcSettings {
  issuer: string
  clientId: string
  clientSecret: string
  /** Registered at the IdP (public URL; TLS ends at the load balancer). */
  redirectUri: string
  postLogoutRedirectUri: string
  /** Only for local development and tests against an IdP that is not behind TLS. */
  allowHttpIssuer?: boolean
}

export interface Config {
  port: number
  oidc: OidcSettings
  /** Base URL of the billing API we call on behalf of the signed-in user. */
  billingApiUrl: string
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = env.PUBLIC_URL ?? 'https://billing.acme.test'
  return {
    port: Number(env.PORT ?? 3000),
    oidc: {
      issuer: required(env, 'OIDC_ISSUER'),
      clientId: env.OIDC_CLIENT_ID ?? 'billing-dashboard',
      clientSecret: required(env, 'OIDC_CLIENT_SECRET'),
      redirectUri: `${publicUrl}/auth/callback`,
      postLogoutRedirectUri: `${publicUrl}/`,
      allowHttpIssuer: env.OIDC_ALLOW_HTTP === 'true',
    },
    billingApiUrl: required(env, 'BILLING_API_URL'),
  }
}
