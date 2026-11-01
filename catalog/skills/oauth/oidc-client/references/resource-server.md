# Validating access tokens in an API

Checked against jose 6.2.14 and oauth4webapi 3.8.8 on Node 24, against a local IdP that rotates
keys and mints forged tokens (alg none, HS256 keyed with the public key, foreign key with a real
`kid`, wrong `typ`, no `exp`).

## What "validate" means (RFC 9068 section 4, RFC 8725)

For a JWT access token, all of these, every request:

1. `typ` header is `at+jwt` or `application/at+jwt` (if your IdP issues RFC 9068 tokens).
2. Signature verifies with a key from the issuer's JWKS, with an algorithm from an explicit
   allowlist; never `none`, never an HMAC algorithm keyed with a public key.
3. `iss` exactly equals the configured issuer (string comparison, trailing slash included).
4. `aud` contains this API's identifier.
5. `exp` is present and in the future (small leeway at most); `nbf`, if present, is not in the future.
6. Then authorization: scopes (`scope` space-separated), roles or other claims, and which tenant or
   resource the `sub` may touch.

Opaque (non-JWT) tokens cannot be validated locally: use introspection (`tokenIntrospection` in
openid-client, RFC 7662) and cache the result briefly.

## jose recipe

```ts
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import type { JWSAlgorithm, JWTPayload, JWTVerifyGetKey } from 'jose'

export interface TokenRules {
  issuer: string
  audience: string
  algorithms: JWSAlgorithm[] // e.g. ['RS256', 'ES256']
}

export function accessTokenVerifier(rules: TokenRules) {
  let keySet: Promise<JWTVerifyGetKey> | undefined
  const loadKeys = () =>
    (keySet ??= (async () => {
      const base = rules.issuer.replace(/\/$/, '')
      const res = await fetch(`${base}/.well-known/openid-configuration`)
      if (!res.ok) throw new Error(`discovery failed: ${res.status}`)
      const doc = (await res.json()) as { issuer?: string; jwks_uri?: string }
      if (doc.issuer !== rules.issuer || !doc.jwks_uri) throw new Error('unexpected discovery document')
      return createRemoteJWKSet(new URL(doc.jwks_uri))
    })().catch((err) => {
      keySet = undefined
      throw err
    }))

  return async (token: string): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(token, await loadKeys(), {
      issuer: rules.issuer,
      audience: rules.audience,
      algorithms: rules.algorithms,
      typ: 'at+jwt',
      requiredClaims: ['exp', 'iat', 'sub', 'client_id'],
      clockTolerance: 30,
    })
    return payload
  }
}
```

Express wiring with RFC 6750 responses:

```ts
function bearerAuth(verify: (t: string) => Promise<JWTPayload>) {
  return async (req, res, next) => {
    const header = req.get('authorization') ?? ''
    const m = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(header)
    if (!m) {
      res.set('WWW-Authenticate', header ? 'Bearer realm="api", error="invalid_request"' : 'Bearer realm="api"')
      return res.status(401).json({ error: 'unauthorized' })
    }
    try {
      res.locals.claims = await verify(m[1])
      next()
    } catch (err) {
      if (!(err instanceof errors.JOSEError)) return next(err) // discovery down, bugs: not a 401
      res.set('WWW-Authenticate', 'Bearer realm="api", error="invalid_token"')
      res.status(401).json({ error: 'invalid_token' })
    }
  }
}

const needScope = (scope: string) => (req, res, next) => {
  const granted = String(res.locals.claims?.scope ?? '').split(' ')
  if (granted.includes(scope)) return next()
  res.set('WWW-Authenticate', `Bearer realm="api", error="insufficient_scope", scope="${scope}"`)
  res.status(403).json({ error: 'insufficient_scope' })
}
```

RFC 6750 section 3: no credentials, or another scheme, gets a challenge without an error code;
a malformed request gets `invalid_request` (400 is allowed, 401 is common); a rejected token gets
`invalid_token` (401; RFC 9068 requires this code for any validation failure); a missing scope gets
`insufficient_scope` (403). Do not accept tokens in the query string (`?access_token=`) in new APIs.

## jose 6 behaviour worth knowing

| Topic | Behaviour (6.2.14) |
| --- | --- |
| `exp`, `nbf`, `iat` | validated only when present; add them to `requiredClaims` to make them mandatory |
| `issuer`, `audience`, `subject`, `maxTokenAge` | each also makes its claim mandatory |
| `aud` arrays | accepted when any value matches `audience` (string or array) |
| `typ` | compared case-insensitively, `application/` prefix ignored; missing `typ` fails when the option is set |
| `algorithms` | defaults to every algorithm usable with the resolved key; `none` is never accepted by `jwtVerify` (unsecured JWTs have their own `UnsecuredJWT` API) |
| HMAC confusion | a remote JWKS holds public keys only, so an `HS256` token finds no matching key and fails |
| `createRemoteJWKSet` | `cacheMaxAge` 600 000 ms, `cooldownDuration` 30 000 ms, `timeoutDuration` 5 000 ms; unknown `kid` triggers a refetch only outside the cooldown; `redirect: 'manual'`, only HTTP 200 accepted; concurrent reloads are shared |
| `createLocalJWKSet` | key selection by `kid`, `kty`, `alg`, `use`, `key_ops`, `crv`; for keys you load and refresh yourself |
| Errors | all extend `errors.JOSEError`: `JWTExpired`, `JWTClaimValidationFailed` (`claim`, `reason`), `JOSEAlgNotAllowed`, `JWSSignatureVerificationFailed`, `JWKSNoMatchingKey`, `JWKSMultipleMatchingKeys`, `JWKSTimeout`, `JWSInvalid`, `JWTInvalid`, `JOSENotSupported` |
| Keys | v6 returns `CryptoKey`; `KeyObject` input still works for verify, but private `KeyObject`s can no longer be used to verify |
| Module | ESM; `require('jose')` only with `require(esm)` (Node 20.19+, 22.12+, 23+) |

`decodeJwt` and `decodeProtectedHeader` do not verify anything. Using them to route (pick a tenant
or issuer) is fine only if the token is then verified against that issuer's keys and rules.

## Key rotation

IdPs publish a new key in the JWKS, start signing with it, and later drop the old one. Some publish
ahead of use (rollover); some switch at once. Your verifier must:

- choose the key by `kid` (never "the first key in the set"),
- refetch the JWKS when it meets an unknown `kid` (rate limited, so random `kid`s cannot make you
  hammer the IdP), and also on a timer,
- accept every algorithm the IdP may move to (RS256 to ES256 or PS256) if you pin algorithms.

`createRemoteJWKSet` does all three when created once and reused. Loading the JWKS at startup into
a constant does none of them. In tests, a fake IdP that rotates its key and a clock moved past the
cooldown (for example `mock.timers.enable({ apis: ['Date'] })` in `node:test`) exercises the path.

## Discovery pitfalls

- OpenID discovery appends to the issuer path: `https://idp.example/realms/main` has its document
  at `https://idp.example/realms/main/.well-known/openid-configuration`. `new URL('/.well-known/...',
  issuer)` drops `/realms/main`. RFC 8414 (`oauth-authorization-server`) instead inserts the
  well-known segment after the origin.
- Read `jwks_uri` from the document; JWKS paths differ per IdP (`/.well-known/jwks.json`,
  `/protocol/openid-connect/certs`, `/oauth2/v1/keys`, ...).
- Check that the document's `issuer` equals the configured issuer before trusting it.

## oauth4webapi alternative

```ts
import * as oauth from 'oauth4webapi'

const issuer = new URL(env.OIDC_ISSUER)
const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer))

// Inside a handler that has a Fetch API Request (Hono, Next.js route handlers, or build one):
const claims = await oauth.validateJwtAccessToken(as, request, 'https://api.example.com')
```

It requires `typ: at+jwt`, the claims `iss exp aud sub iat jti client_id`, checks `iss` and `aud`,
verifies the signature with keys from `as.jwks_uri` (cached for 5 minutes, refetched for an unknown
`kid` once the cache is at least 60 s old), handles DPoP-bound tokens, and throws
`OperationProcessingError` (or `UnsupportedOperationError` for other auth schemes), which you map
to 401. Clock tolerance defaults to 30 s.

## Things that are not validation

- Checking only that the token "looks like a JWT", has three parts, or decodes.
- Verifying the signature but not `aud`: any token from the same IdP for any API is accepted.
- Accepting ID tokens because they are signed by the same IdP. ID tokens are for the client, have
  the client id as `aud`, and say nothing about API permissions.
- Trusting `x-user-id` headers from a gateway without a network or mTLS guarantee that only the
  gateway can reach the service.
