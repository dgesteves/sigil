// A small in-process OpenID Provider for tests, modelled on our Keycloak realm.
//
// It implements what our services talk to: discovery, a JWKS with key rotation, the authorization
// endpoint (the signed-in user is chosen by the test with the `x-test-user` header), the token
// endpoint (client_secret_basic or client_secret_post, PKCE S256, exact redirect_uri, one-time
// codes, refresh token rotation with reuse detection), RP-initiated logout and userinfo.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { CryptoKey, JWK, JWTPayload } from 'jose'

export type SigningAlg = 'RS256' | 'ES256'

interface SigningKey {
  kid: string
  alg: SigningAlg
  privateKey: CryptoKey
  jwk: JWK
}

export interface TestUser {
  sub: string
  email: string
  name: string
}

export interface TestClient {
  clientId: string
  clientSecret: string
  redirectUris: string[]
  postLogoutRedirectUris?: string[]
}

export interface IdpOptions {
  clients?: TestClient[]
  users?: TestUser[]
  /** `aud` of the access tokens the IdP issues (the resource server identifier). */
  apiAudience?: string
  accessTokenTtl?: number
  idTokenTtl?: number
  /** Simulated network/processing latency of the token endpoint. */
  tokenLatencyMs?: number
  /** Issuer path, Keycloak style. */
  realmPath?: string
  initialKeyAlg?: SigningAlg
}

interface CodeRecord {
  clientId: string
  redirectUri: string
  codeChallenge: string
  nonce?: string
  scope: string
  user: TestUser
  used: boolean
  familyId?: string
}

interface RefreshRecord {
  familyId: string
  clientId: string
  user: TestUser
  scope: string
  status: 'active' | 'used' | 'revoked'
}

interface AccessRecord {
  familyId?: string
  sub: string
  clientId: string
  exp: number
  revoked: boolean
}

export interface TokenEvent {
  grantType: string
  clientId?: string
  clientAuth?: 'client_secret_basic' | 'client_secret_post'
  ok: boolean
  error?: string
  refreshToken?: string
  /** The authorization code presented, for authorization_code grants. */
  code?: string
  /** A refresh token that had already been rotated was presented again. */
  reuseDetected?: boolean
}

export interface IssuedTokens {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  id_token?: string
  scope: string
}

/** Lets a test hand out a broken ID token: change claims, header, or how it is signed. */
export interface IdTokenTamper {
  claims?: (claims: JWTPayload) => JWTPayload
  header?: Record<string, unknown>
  signWith?: 'none' | 'hs256-client-secret' | 'foreign-key'
}

const now = () => Math.floor(Date.now() / 1000)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')
const sha256 = (input: string) => createHash('sha256').update(input).digest('base64url')

export const defaultUsers: TestUser[] = [
  { sub: 'f3a1c9e2-alice', email: 'alice@example.com', name: 'Alice Moreau' },
  { sub: '7b2d4e60-bob', email: 'bob@example.com', name: 'Bob Okafor' },
  { sub: '0c9e1f37-mallory', email: 'mallory@example.net', name: 'Mallory Quinn' },
]

export class TestIdp {
  readonly options: Required<Omit<IdpOptions, 'clients' | 'users'>>
  readonly clients = new Map<string, TestClient>()
  readonly users = new Map<string, TestUser>()
  /** Every authorization request the IdP received, as query parameters. */
  readonly authorizationRequests: Record<string, string>[] = []
  readonly tokenEvents: TokenEvent[] = []
  readonly logoutRequests: Record<string, string>[] = []
  /** Every ID token the token endpoint handed out, newest last. */
  readonly issuedIdTokens: string[] = []
  readonly jwksRequests: number[] = []

  #server: Server
  #origin = ''
  #keys: SigningKey[] = []
  #activeKid = ''
  #foreignKey?: SigningKey
  #codes = new Map<string, CodeRecord>()
  #refreshTokens = new Map<string, RefreshRecord>()
  #accessTokens = new Map<string, AccessRecord>()
  #idTokenTampers: IdTokenTamper[] = []
  #authorizationErrors: string[] = []
  #tokenFailures: number[] = []
  #outage?: number

  private constructor(options: IdpOptions) {
    this.options = {
      apiAudience: options.apiAudience ?? 'https://api.example.test',
      accessTokenTtl: options.accessTokenTtl ?? 300,
      idTokenTtl: options.idTokenTtl ?? 300,
      tokenLatencyMs: options.tokenLatencyMs ?? 15,
      realmPath: options.realmPath ?? '/realms/acme',
      initialKeyAlg: options.initialKeyAlg ?? 'RS256',
    }
    for (const c of options.clients ?? []) this.clients.set(c.clientId, c)
    for (const u of options.users ?? defaultUsers) this.users.set(u.sub, u)
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((err: unknown) => {
        res.statusCode = 500
        res.end(String(err))
      })
    })
  }

  static async start(options: IdpOptions = {}): Promise<TestIdp> {
    const idp = new TestIdp(options)
    await idp.rotateKey(idp.options.initialKeyAlg)
    await new Promise<void>((resolve) => idp.#server.listen(0, '127.0.0.1', resolve))
    const { port } = idp.#server.address() as AddressInfo
    idp.#origin = `http://127.0.0.1:${port}`
    return idp
  }

  get issuer(): string {
    return `${this.#origin}${this.options.realmPath}`
  }

  endpoint(name: 'auth' | 'token' | 'certs' | 'logout' | 'userinfo'): string {
    return `${this.issuer}/protocol/openid-connect/${name}`
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
  }

  // ── Keys ──────────────────────────────────────────────────────────────────────────────────────

  async #newKey(alg: SigningAlg): Promise<SigningKey> {
    const { privateKey, publicKey } = await generateKeyPair(alg)
    const jwk = await exportJWK(publicKey)
    const kid = randomUUID()
    return { kid, alg, privateKey, jwk: { ...jwk, kid, alg, use: 'sig' } }
  }

  /** Starts signing with a new key. The old key leaves the JWKS unless `keepPrevious` is set. */
  async rotateKey(alg: SigningAlg = 'RS256', { keepPrevious = false } = {}): Promise<string> {
    const key = await this.#newKey(alg)
    this.#keys = keepPrevious ? [...this.#keys, key] : [key]
    this.#activeKid = key.kid
    return key.kid
  }

  /** Publishes a key in the JWKS ahead of using it (rollover), without signing with it yet. */
  async publishNextKey(alg: SigningAlg = 'RS256'): Promise<string> {
    const key = await this.#newKey(alg)
    this.#keys = [...this.#keys, key]
    return key.kid
  }

  activateKey(kid: string): void {
    if (!this.#keys.some((k) => k.kid === kid)) throw new Error(`unknown kid ${kid}`)
    this.#activeKid = kid
  }

  get activeKid(): string {
    return this.#activeKid
  }

  publicJwks(): { keys: JWK[] } {
    return { keys: this.#keys.map((k) => k.jwk) }
  }

  #key(kid = this.#activeKid): SigningKey {
    const key = this.#keys.find((k) => k.kid === kid)
    if (!key) throw new Error(`unknown kid ${kid}`)
    return key
  }

  /**
   * Signs any JWT the way the IdP would. `signWith` produces the classic forgeries:
   * an unsecured token, an HMAC token keyed with a public key or the client secret, or a token
   * signed by a key the IdP does not own but carrying the IdP's current `kid`.
   */
  async sign(
    claims: JWTPayload,
    header: Record<string, unknown> & { typ?: string } = {},
    opts: {
      kid?: string
      signWith?: 'none' | 'hs256-public-pem' | 'hs256-public-jwk' | 'hs256-secret' | 'foreign-key'
      secret?: string
    } = {},
  ): Promise<string> {
    const key = this.#key(opts.kid)
    switch (opts.signWith) {
      case 'none': {
        const h = b64url(JSON.stringify({ alg: 'none', ...header }))
        return `${h}.${b64url(JSON.stringify(claims))}.`
      }
      case 'hs256-public-pem':
      case 'hs256-public-jwk':
      case 'hs256-secret': {
        let secret: Uint8Array
        if (opts.signWith === 'hs256-secret') secret = new TextEncoder().encode(opts.secret ?? '')
        else if (opts.signWith === 'hs256-public-jwk')
          secret = new TextEncoder().encode(JSON.stringify(key.jwk))
        else secret = new TextEncoder().encode(await publicPem(key))
        return new SignJWT(claims)
          .setProtectedHeader({ ...header, alg: 'HS256', kid: key.kid })
          .sign(secret)
      }
      case 'foreign-key': {
        this.#foreignKey ??= await this.#newKey(key.alg)
        return new SignJWT(claims)
          .setProtectedHeader({ ...header, alg: key.alg, kid: key.kid })
          .sign(this.#foreignKey.privateKey)
      }
      default:
        return new SignJWT(claims)
          .setProtectedHeader({ ...header, alg: key.alg, kid: key.kid })
          .sign(key.privateKey)
    }
  }

  /** An RFC 9068 JWT access token for `apiAudience`, as the token endpoint would issue it. */
  async accessToken(
    overrides: JWTPayload = {},
    opts: { typ?: string; kid?: string; ttl?: number; familyId?: string } = {},
  ): Promise<string> {
    const user = [...this.users.values()][0]
    const iat = now()
    const claims: JWTPayload = {
      iss: this.issuer,
      sub: user.sub,
      aud: this.options.apiAudience,
      exp: iat + (opts.ttl ?? this.options.accessTokenTtl),
      iat,
      jti: randomUUID(),
      client_id: [...this.clients.keys()][0] ?? 'test-client',
      scope: 'openid profile',
      ...overrides,
    }
    for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k]
    const token = await this.sign(claims, { typ: opts.typ ?? 'at+jwt' }, { kid: opts.kid })
    this.#accessTokens.set(String(claims.jti), {
      familyId: opts.familyId,
      sub: String(claims.sub),
      clientId: String(claims.client_id),
      exp: Number(claims.exp),
      revoked: false,
    })
    return token
  }

  /** An OpenID Connect ID token for `clientId`. */
  async idToken(clientId: string, user: TestUser, extra: JWTPayload = {}): Promise<string> {
    const iat = now()
    return this.sign(
      {
        iss: this.issuer,
        sub: user.sub,
        aud: clientId,
        exp: iat + this.options.idTokenTtl,
        iat,
        auth_time: iat,
        email: user.email,
        email_verified: true,
        name: user.name,
        ...extra,
      },
      { typ: 'JWT' },
    )
  }

  // ── Behaviour switches for tests ──────────────────────────────────────────────────────────────

  /** Lifetime (seconds) of access tokens issued from now on. */
  setAccessTokenTtl(seconds: number): void {
    this.options.accessTokenTtl = seconds
  }

  /** The next authorization request is answered with this OAuth error instead of a code. */
  failNextAuthorization(error = 'access_denied'): void {
    this.#authorizationErrors.push(error)
  }

  /** The next ID token the token endpoint issues is altered. */
  tamperNextIdToken(tamper: IdTokenTamper): void {
    this.#idTokenTampers.push(tamper)
  }

  /** The next `count` token requests fail with this HTTP status (temporarily_unavailable). */
  failNextTokenRequests(count = 1, status = 503): void {
    for (let i = 0; i < count; i++) this.#tokenFailures.push(status)
  }

  /** Until `endOutage()`, every token request fails with this HTTP status. */
  startOutage(status = 503): void {
    this.#outage = status
  }

  endOutage(): void {
    this.#outage = undefined
  }

  /** Revokes every refresh token of a user, as an admin "sign out everywhere" would. */
  revokeUserSessions(sub: string): void {
    for (const rt of this.#refreshTokens.values()) if (rt.user.sub === sub) rt.status = 'revoked'
    for (const at of this.#accessTokens.values()) if (at.sub === sub) at.revoked = true
  }

  refreshTokenStatus(token: string): RefreshRecord['status'] | undefined {
    return this.#refreshTokens.get(token)?.status
  }

  /** Issues a token set directly, as if `user` had just logged in to `clientId`. */
  async issueTokens(
    clientId: string,
    user: TestUser,
    opts: { accessTokenTtl?: number; scope?: string } = {},
  ): Promise<IssuedTokens> {
    return this.#issue(clientId, user, opts.scope ?? 'openid profile email offline_access', {
      familyId: randomUUID(),
      accessTokenTtl: opts.accessTokenTtl,
    })
  }

  /** What a resource server backed by this IdP would accept: a live, unrevoked access token. */
  checkAccessToken(token: string): { sub: string; clientId: string } | undefined {
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
      const record = this.#accessTokens.get(String(claims.jti))
      if (!record || record.revoked || record.exp <= now()) return undefined
      return { sub: record.sub, clientId: record.clientId }
    } catch {
      return undefined
    }
  }

  refreshGrants(): TokenEvent[] {
    return this.tokenEvents.filter((e) => e.grantType === 'refresh_token')
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────────────────────────

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.#origin)
    const base = this.options.realmPath
    switch (`${req.method} ${url.pathname}`) {
      case `GET ${base}/.well-known/openid-configuration`:
        return json(res, 200, this.#metadata())
      case `GET ${base}/protocol/openid-connect/certs`:
        this.jwksRequests.push(Date.now())
        res.setHeader('cache-control', 'public, max-age=300')
        return json(res, 200, this.publicJwks())
      case `GET ${base}/protocol/openid-connect/auth`:
        return this.#authorize(req, url, res)
      case `POST ${base}/protocol/openid-connect/token`:
        return this.#token(req, res)
      case `GET ${base}/protocol/openid-connect/logout`:
        return this.#logout(url, res)
      case `GET ${base}/protocol/openid-connect/userinfo`:
        return this.#userinfo(req, res)
      default:
        return json(res, 404, { error: 'not_found' })
    }
  }

  #metadata() {
    return {
      issuer: this.issuer,
      authorization_endpoint: this.endpoint('auth'),
      token_endpoint: this.endpoint('token'),
      jwks_uri: this.endpoint('certs'),
      userinfo_endpoint: this.endpoint('userinfo'),
      end_session_endpoint: this.endpoint('logout'),
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256', 'ES256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'email', 'name'],
      authorization_response_iss_parameter_supported: true,
    }
  }

  #authorize(req: IncomingMessage, url: URL, res: ServerResponse): void {
    const q = url.searchParams
    this.authorizationRequests.push(Object.fromEntries(q))
    const client = this.clients.get(q.get('client_id') ?? '')
    if (!client) return text(res, 400, 'Unknown client_id')
    const redirectUri = q.get('redirect_uri') ?? ''
    // Exact string comparison, as RFC 9700 requires: no prefix or pattern matching.
    if (!client.redirectUris.includes(redirectUri))
      return text(res, 400, 'redirect_uri is not registered for this client')

    const state = q.get('state') ?? undefined
    const respond = (params: Record<string, string | undefined>) => {
      const target = new URL(redirectUri)
      for (const [k, v] of Object.entries({ ...params, state, iss: this.issuer }))
        if (v !== undefined) target.searchParams.set(k, v)
      res.statusCode = 302
      res.setHeader('location', target.href)
      res.end()
    }

    if (q.get('response_type') !== 'code') return respond({ error: 'unsupported_response_type' })
    const scope = q.get('scope') ?? ''
    if (!scope.split(' ').includes('openid')) return respond({ error: 'invalid_scope' })
    const codeChallenge = q.get('code_challenge')
    if (!codeChallenge || q.get('code_challenge_method') !== 'S256')
      return respond({ error: 'invalid_request', error_description: 'PKCE with S256 is required' })
    const forced = this.#authorizationErrors.shift()
    if (forced) return respond({ error: forced })
    const user = this.#userFrom(req)
    if (!user) return respond({ error: 'login_required' })

    const code = randomBytes(24).toString('base64url')
    this.#codes.set(code, {
      clientId: client.clientId,
      redirectUri,
      codeChallenge,
      nonce: q.get('nonce') ?? undefined,
      scope,
      user,
      used: false,
    })
    respond({ code })
  }

  #userFrom(req: IncomingMessage): TestUser | undefined {
    const wanted = String(req.headers['x-test-user'] ?? '')
    if (!wanted) return undefined
    return [...this.users.values()].find(
      (u) => u.sub === wanted || u.email === wanted || u.email.split('@')[0] === wanted,
    )
  }

  async #token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = new URLSearchParams(await readBody(req))
    await sleep(this.options.tokenLatencyMs)
    res.setHeader('cache-control', 'no-store')
    const grantType = body.get('grant_type') ?? ''
    const event: TokenEvent = { grantType, ok: false }
    this.tokenEvents.push(event)
    const fail = (status: number, error: string, description?: string) => {
      event.error = error
      json(res, status, { error, error_description: description })
    }

    const outage = this.#outage ?? this.#tokenFailures.shift()
    if (outage) return fail(outage, 'temporarily_unavailable', 'The IdP is restarting')

    const client = this.#authenticateClient(req, body, event)
    if (!client) {
      res.setHeader('www-authenticate', 'Basic realm="acme"')
      return fail(401, 'invalid_client')
    }

    if (grantType === 'authorization_code') {
      const code = body.get('code') ?? ''
      event.code = code
      const record = this.#codes.get(code)
      if (!record || record.clientId !== client.clientId) return fail(400, 'invalid_grant')
      if (record.used) {
        // RFC 6749 4.1.2: a code used twice revokes what was issued for it.
        if (record.familyId) this.#revokeFamily(record.familyId)
        return fail(400, 'invalid_grant', 'authorization code already used')
      }
      record.used = true
      if (body.get('redirect_uri') !== record.redirectUri)
        return fail(400, 'invalid_grant', 'redirect_uri does not match the authorization request')
      const verifier = body.get('code_verifier') ?? ''
      if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) || sha256(verifier) !== record.codeChallenge)
        return fail(400, 'invalid_grant', 'PKCE verification failed')
      const familyId = randomUUID()
      record.familyId = familyId
      const tokens = await this.#issue(client.clientId, record.user, record.scope, {
        familyId,
        nonce: record.nonce,
        tamper: this.#idTokenTampers.shift(),
      })
      event.ok = true
      return json(res, 200, tokens)
    }

    if (grantType === 'refresh_token') {
      const presented = body.get('refresh_token') ?? ''
      event.refreshToken = presented
      const record = this.#refreshTokens.get(presented)
      if (!record || record.clientId !== client.clientId) return fail(400, 'invalid_grant')
      if (record.status === 'used') {
        // Reuse detection: a rotated refresh token came back, so assume it was stolen and end the
        // whole login (every refresh and access token issued from it).
        event.reuseDetected = true
        this.#revokeFamily(record.familyId)
        return fail(400, 'invalid_grant', 'refresh token reuse detected')
      }
      if (record.status === 'revoked') return fail(400, 'invalid_grant', 'session ended')
      record.status = 'used'
      // Like many IdPs, refresh responses carry no new ID token.
      const tokens = await this.#issue(client.clientId, record.user, record.scope, {
        familyId: record.familyId,
        withIdToken: false,
      })
      event.ok = true
      return json(res, 200, tokens)
    }

    return fail(400, 'unsupported_grant_type')
  }

  #authenticateClient(
    req: IncomingMessage,
    body: URLSearchParams,
    event: TokenEvent,
  ): TestClient | undefined {
    const header = req.headers.authorization
    let id: string | null = null
    let secret: string | null = null
    if (header?.startsWith('Basic ')) {
      if (body.has('client_secret')) return undefined // one method per request (RFC 6749 2.3)
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const i = decoded.indexOf(':')
      const formDecode = (s: string) => decodeURIComponent(s.replaceAll('+', ' '))
      id = formDecode(decoded.slice(0, i))
      secret = formDecode(decoded.slice(i + 1))
      event.clientAuth = 'client_secret_basic'
    } else if (body.has('client_secret')) {
      id = body.get('client_id')
      secret = body.get('client_secret')
      event.clientAuth = 'client_secret_post'
    }
    const client = this.clients.get(id ?? '')
    event.clientId = id ?? undefined
    if (!client || secret !== client.clientSecret) return undefined
    return client
  }

  async #issue(
    clientId: string,
    user: TestUser,
    scope: string,
    opts: {
      familyId: string
      nonce?: string
      tamper?: IdTokenTamper
      accessTokenTtl?: number
      withIdToken?: boolean
    },
  ): Promise<IssuedTokens> {
    const client = this.clients.get(clientId)
    const ttl = opts.accessTokenTtl ?? this.options.accessTokenTtl
    const access = await this.accessToken(
      { sub: user.sub, client_id: clientId, scope },
      { ttl, familyId: opts.familyId },
    )
    const refresh = randomBytes(32).toString('base64url')
    this.#refreshTokens.set(refresh, {
      familyId: opts.familyId,
      clientId,
      user,
      scope,
      status: 'active',
    })
    const issued: IssuedTokens = {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ttl,
      refresh_token: refresh,
      scope,
    }
    if (opts.withIdToken === false) return issued

    const iat = now()
    let claims: JWTPayload = {
      iss: this.issuer,
      sub: user.sub,
      aud: clientId,
      exp: iat + this.options.idTokenTtl,
      iat,
      auth_time: iat,
      email: user.email,
      email_verified: true,
      name: user.name,
      ...(opts.nonce ? { nonce: opts.nonce } : {}),
    }
    const tamper = opts.tamper
    if (tamper?.claims) claims = tamper.claims({ ...claims })
    const header = { typ: 'JWT', ...tamper?.header }
    let id: string
    if (tamper?.signWith === 'hs256-client-secret')
      id = await this.sign(claims, header, { signWith: 'hs256-secret', secret: client?.clientSecret })
    else id = await this.sign(claims, header, { signWith: tamper?.signWith })
    this.issuedIdTokens.push(id)
    return { ...issued, id_token: id }
  }

  #revokeFamily(familyId: string): void {
    for (const rt of this.#refreshTokens.values()) if (rt.familyId === familyId) rt.status = 'revoked'
    for (const at of this.#accessTokens.values()) if (at.familyId === familyId) at.revoked = true
  }

  #logout(url: URL, res: ServerResponse): void {
    const q = Object.fromEntries(url.searchParams)
    this.logoutRequests.push(q)
    const client = this.clients.get(q.client_id ?? '')
    const target = q.post_logout_redirect_uri
    if (target && client?.postLogoutRedirectUris?.includes(target)) {
      res.statusCode = 302
      res.setHeader('location', target)
      return void res.end()
    }
    text(res, 200, 'You are signed out')
  }

  #userinfo(req: IncomingMessage, res: ServerResponse): void {
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
    const live = this.checkAccessToken(token)
    const user = live && this.users.get(live.sub)
    if (!user) {
      res.setHeader('www-authenticate', 'Bearer error="invalid_token"')
      return json(res, 401, { error: 'invalid_token' })
    }
    json(res, 200, { sub: user.sub, email: user.email, name: user.name })
  }
}

async function publicPem(key: SigningKey): Promise<string> {
  const { createPublicKey } = await import('node:crypto')
  return createPublicKey({ key: key.jwk as never, format: 'jwk' })
    .export({ type: 'spki', format: 'pem' })
    .toString()
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function text(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end(body)
}
