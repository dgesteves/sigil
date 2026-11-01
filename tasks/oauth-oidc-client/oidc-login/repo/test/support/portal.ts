import { createApp } from '../../src/app.ts'
import type { Config } from '../../src/config.ts'
import { Browser, type Hop } from './browser.ts'
import { listen } from './http.ts'
import { TestIdp } from './idp.ts'

export const PUBLIC_ORIGIN = 'https://portal.example.test'

export interface Portal {
  idp: TestIdp
  config: Config
  /** A new browser with its own cookies, reaching the portal through the TLS proxy. */
  browser(): Browser
  close(): Promise<void>
}

export async function startPortal(): Promise<Portal> {
  const client = {
    clientId: 'partner-portal',
    clientSecret: 'portal-client-secret-6b1f',
    redirectUris: [`${PUBLIC_ORIGIN}/auth/callback`],
    postLogoutRedirectUris: [`${PUBLIC_ORIGIN}/`],
  }
  const idp = await TestIdp.start({ clients: [client] })
  const config: Config = {
    port: 0,
    sessionSecret: 'test-session-secret-not-for-production',
    oidc: {
      issuer: idp.issuer,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri: `${PUBLIC_ORIGIN}/auth/callback`,
      postLogoutRedirectUri: `${PUBLIC_ORIGIN}/`,
      allowHttpIssuer: true,
    },
  }
  const app = await listen(createApp(config))
  return {
    idp,
    config,
    browser: () => new Browser({ [PUBLIC_ORIGIN]: app.url }),
    close: async () => {
      await app.close()
      await idp.close()
    },
  }
}

/** GET /login and return where the portal sends the browser. */
export async function startLogin(browser: Browser): Promise<URL> {
  const hop = await browser.get(`${PUBLIC_ORIGIN}/login`)
  if (hop.status < 300 || hop.status > 399 || !hop.location)
    throw new Error(`/login answered ${hop.status} instead of redirecting: ${hop.body.slice(0, 200)}`)
  return new URL(hop.location)
}

/** The user signs in at the IdP; returns the callback URL the IdP redirects back to. */
export async function signInAtIdp(browser: Browser, authorizationUrl: URL, user: string): Promise<string> {
  const hop = await browser.get(authorizationUrl.href, { 'x-test-user': user })
  if (!hop.location) throw new Error(`the IdP answered ${hop.status}: ${hop.body}`)
  return hop.location
}

export function finishLogin(browser: Browser, callbackUrl: string): Promise<Hop> {
  return browser.get(callbackUrl)
}

export async function whoAmI(browser: Browser): Promise<{ status: number; user?: Record<string, unknown> }> {
  const hop = await browser.get(`${PUBLIC_ORIGIN}/me`)
  return { status: hop.status, user: hop.status === 200 ? JSON.parse(hop.body) : undefined }
}

/** The whole happy path: /login, sign in at the IdP, back to the callback. */
export async function login(browser: Browser, user: string): Promise<Hop> {
  const authorizationUrl = await startLogin(browser)
  const callback = await signInAtIdp(browser, authorizationUrl, user)
  return finishLogin(browser, callback)
}
