export interface AuthConfig {
  /** Issuer identifier of our IdP realm, exactly as it appears in the `iss` claim. */
  issuer: string
  /** This API's identifier at the IdP. Access tokens meant for us carry it in `aud`. */
  audience: string
}

export interface Config {
  port: number
  auth: AuthConfig
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const issuer = env.OIDC_ISSUER
  if (!issuer) throw new Error('OIDC_ISSUER is required')
  return {
    port: Number(env.PORT ?? 8080),
    auth: {
      issuer,
      audience: env.API_AUDIENCE ?? 'https://shipments.api.acme.test',
    },
  }
}
