# openid-client v6 in practice

Checked against openid-client 6.8.8 (which depends on oauth4webapi ^3.8.8 and jose ^6.2.12) on
Node 24. v6.0.0 (2024-10-15) was a complete rewrite; v5's last release is 5.7.1 (2024-11-22), and
the v6 README lists only v6.x as supported.

## v5 to v6 map

| v5 (classes, CommonJS-friendly) | v6 (functions over a `Configuration`) |
| --- | --- |
| `const issuer = await Issuer.discover(url)` | `const config = await discovery(new URL(issuer), clientId, clientSecret)` |
| `new issuer.Client({ client_id, client_secret, redirect_uris, response_types })` | nothing: `discovery()` returns the configuration; `redirect_uri` is passed per call |
| `token_endpoint_auth_method: 'client_secret_basic'` | `discovery(url, clientId, undefined, ClientSecretBasic(secret))` (default with a secret string: `ClientSecretPost`) |
| `generators.codeVerifier()` | `randomPKCECodeVerifier()` |
| `generators.codeChallenge(v)` (sync) | `await calculatePKCECodeChallenge(v)` (**async**) |
| `generators.state()`, `generators.nonce()` | `randomState()`, `randomNonce()` |
| `client.authorizationUrl({ ... })` returns a string | `buildAuthorizationUrl(config, { redirect_uri, ... })` returns a `URL` |
| `client.callbackParams(req)` + `client.callback(redirectUri, params, { code_verifier, state, nonce })` | `authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier, expectedState, expectedNonce })` |
| `tokenSet.claims()` | `tokens.claims()` (same idea, helper on the response) |
| `tokenSet.expired()`, `tokenSet.expires_at` | `tokens.expiresIn()` (seconds left, `0` when expired); store your own `expiresAt` |
| `client.refresh(refreshToken)` | `refreshTokenGrant(config, refreshToken, params?)` |
| `client.userinfo(accessToken)` | `fetchUserInfo(config, accessToken, expectedSub)` (pass `claims().sub`, or `skipSubjectCheck`) |
| `client.endSessionUrl({ id_token_hint, post_logout_redirect_uri })` | `buildEndSessionUrl(config, { id_token_hint, post_logout_redirect_uri })` |
| `client.grant({ grant_type: 'client_credentials', ... })` | `clientCredentialsGrant(config, { scope, resource })` |
| `client.introspect(token)`, `client.revoke(token)` | `tokenIntrospection(config, token)`, `tokenRevocation(config, token)` |
| `client.requestResource(url, token)` | `fetchProtectedResource(config, token, url, method, body?, headers?)` |
| `custom.setHttpOptionsDefaults({ timeout })` | `discovery(..., { timeout: seconds })` (default 30 s) or `config[customFetch]` |
| `const { Strategy } = require('openid-client')` | `import { Strategy } from 'openid-client/passport'` |
| `require('openid-client')` anywhere | ESM; `require()` only where Node supports `require(esm)` (20.19+, 22.12+, 23+) |

v6 exports (6.8.8), for orientation: `discovery`, `Configuration`, `buildAuthorizationUrl`,
`buildAuthorizationUrlWithPAR`, `buildAuthorizationUrlWithJAR`, `authorizationCodeGrant`,
`refreshTokenGrant`, `clientCredentialsGrant`, `genericGrantRequest`, `fetchUserInfo`,
`fetchProtectedResource`, `tokenIntrospection`, `tokenRevocation`, `buildEndSessionUrl`,
`randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `randomState`, `randomNonce`,
`allowInsecureRequests`, `enableNonRepudiationChecks`, `useJwtResponseMode`, `getDPoPHandle`,
`randomDPoPKeyPair`, `customFetch`, `clockSkew`, `clockTolerance`, `skipStateCheck`,
`skipSubjectCheck`, the client auth factories (`ClientSecretPost`, `ClientSecretBasic`,
`ClientSecretJwt`, `PrivateKeyJwt`, `TlsClientAuth`, `None`) and the error classes below.

## Discovery and configuration

```ts
import * as oidc from 'openid-client'

let configPromise: Promise<oidc.Configuration> | undefined
export function idp(): Promise<oidc.Configuration> {
  configPromise ??= oidc
    .discovery(new URL(env.OIDC_ISSUER), env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET, undefined, {
      execute: env.OIDC_ALLOW_HTTP === 'true' ? [oidc.allowInsecureRequests] : [],
      timeout: 10,
    })
    .catch((err) => {
      configPromise = undefined // retry discovery next time instead of caching the failure
      throw err
    })
  return configPromise
}
```

- Pass the **issuer**, not the discovery URL. With the issuer, the library builds
  `<issuer>/.well-known/openid-configuration` (path kept: `https://idp/realms/main` becomes
  `https://idp/realms/main/.well-known/openid-configuration`) and checks that the document's `issuer`
  matches. Passing the discovery URL directly works but skips that check.
- `algorithm: 'oauth2'` switches to RFC 8414 (`/.well-known/oauth-authorization-server` inserted
  after the origin) for pure OAuth servers.
- `config.serverMetadata()` exposes the metadata and helpers such as `supportsPKCE()`.
- `allowInsecureRequests` is marked deprecated on purpose, to stand out. It applies to discovery and
  to every later request made with that configuration.

## Authorization request

`buildAuthorizationUrl(config, params)` adds `client_id` and `response_type=code` and encodes the
rest as given. You pass `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method`, and
optionally `state`, `nonce`, `prompt`, `max_age`, `login_hint`, `resource`, `acr_values`.

The README's example skips `state` when the server advertises PKCE support, because RFC 9700 lets
PKCE provide CSRF protection then. Sending `state` (and, for OpenID Connect, `nonce`) as well costs
nothing and keeps you safe with servers that accept code exchanges without PKCE.

If the IdP advertises `pushed_authorization_request_endpoint`, `buildAuthorizationUrlWithPAR`
sends the parameters over the back channel and returns a short URL with `request_uri`.

## Callback

`authorizationCodeGrant(config, currentUrl, checks?, tokenEndpointParameters?, options?)`:

1. Validates the authorization response: `iss` (RFC 9207) against the issuer, rejecting a missing
   `iss` when `authorization_response_iss_parameter_supported` is true; `state` against
   `checks.expectedState` (undefined = must be absent); `error` responses become
   `AuthorizationResponseError`.
2. Sends the token request with `code`, `code_verifier` and `redirect_uri` = `currentUrl` without
   query and fragment. Extra token parameters cannot override `redirect_uri`.
3. Validates the token response and ID token (see SKILL.md section 2 for the list), and returns the
   response with `claims()` and `expiresIn()` helpers.

When the registered redirect URI itself has a query string, or URL normalisation changes it (a bare
origin gains a trailing slash), the derived `redirect_uri` will not match. The documented workaround
replaces it in a custom fetch:

```ts
config[oidc.customFetch] = (url, options) => {
  if (options.body instanceof URLSearchParams && options.body.get('grant_type') === 'authorization_code')
    options.body.set('redirect_uri', registeredRedirectUri)
  return fetch(url, options)
}
```

`currentUrl` may also be a Fetch API `Request` (for frameworks built on it); `form_post` responses
are read from a POST body that way.

## Errors

| Class (all exported by openid-client) | When | Useful fields |
| --- | --- | --- |
| `AuthorizationResponseError` | callback carries `error=...` (user cancelled, consent denied) | `error`, `error_description` |
| `ResponseBodyError` | 4xx JSON error from the token endpoint, e.g. `invalid_grant` | `error`, `error_description`, `status` |
| `WWWAuthenticateChallengeError` | 401 with `WWW-Authenticate`, e.g. wrong client secret | `cause` (parsed challenges), `status` |
| `ClientError` | everything the library rejects itself | `code`: `OAUTH_JWT_CLAIM_COMPARISON_FAILED` (ID token `iss`, `aud`, `azp`, `nonce`), `OAUTH_JWT_TIMESTAMP_CHECK_FAILED` (expired), `OAUTH_INVALID_RESPONSE` (callback `state` or `iss` wrong or missing, unexpected `alg`, missing claims), `OAUTH_RESPONSE_IS_NOT_CONFORM` (unexpected status such as 5xx), `OAUTH_HTTP_REQUEST_FORBIDDEN` (HTTP without `allowInsecureRequests`) |
| `TypeError` | wrong argument types, and network failures (`fetch failed`, cause `ECONNREFUSED`) | `cause` |

Log `err.code`/`err.error`, not the whole error object: causes can contain the response body and
tokens.

## Timeouts, retries and fetch

- Default request timeout is 30 s (`timeout` option on `discovery`, seconds). Lower it for
  user-facing paths.
- The library does not retry. Retry idempotent calls (discovery, JWKS) yourself if needed; never
  retry an authorization code exchange, and retry a refresh only after a transient failure with the
  same, still unused refresh token.
- `config[oidc.customFetch]` takes over every HTTP call (proxies, mTLS agents, test doubles).

## ID token signature

By default the ID token from the token endpoint is not signature-checked (allowed by OIDC Core
3.1.3.7 when the token comes over TLS). `enableNonRepudiationChecks(config)` adds JWKS-based
signature verification for ID tokens and JWT responses (JWT UserInfo, JWT introspection); use it when the token is stored as
evidence, passed to other services, or the token endpoint is not TLS-protected.

## Other grants in one line each

- Client credentials: `clientCredentialsGrant(config, { scope, resource })`. Cache the token until
  shortly before `expires_in`; share the in-flight request like a refresh.
- Device flow: `initiateDeviceAuthorization` then `pollDeviceAuthorizationGrant` (handles
  `slow_down` and, since 6.8.0, `Retry-After`).
- DPoP: `getDPoPHandle(config, await randomDPoPKeyPair())` and pass `{ DPoP: handle }` to grants
  and `fetchProtectedResource`.
