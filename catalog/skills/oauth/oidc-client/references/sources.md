# Sources

All checked on 2026-11-01. Versions come from the npm registry (`npm view <pkg> version time`);
library behaviour was read in the published package source and type declarations, then run on
Node 24 (24.18 locally, 24.22.2 in `node:24-bookworm`) against a local OpenID Provider built with
jose (discovery, JWKS with rotation, PKCE, exact redirect URIs, client authentication, refresh token
rotation with reuse detection, forged tokens).

## Packages

| Package | Version | Published | Notes |
| --- | --- | --- | --- |
| openid-client | 6.8.8 | 2026-09-05 | depends on `jose ^6.2.12`, `oauth4webapi ^3.8.8`; v6.0.0 (rewrite) 2024-10-15; last v5 is 5.7.1 (2024-11-22) |
| jose | 6.2.14 | 2026-10-29 | v6.0.0 2025-02-22 (CryptoKey everywhere, fetch-based remote JWKS, ESM) |
| oauth4webapi | 3.8.8 | 2026-09-05 | |
| express | 5.3.0 | 2026-10-09 | used in the examples and the proof suite |
| express-session | 1.19.0 | 2026-01-22 | `regenerate`, `resave` race note |

- npm: https://www.npmjs.com/package/openid-client, https://www.npmjs.com/package/jose,
  https://www.npmjs.com/package/oauth4webapi
- openid-client README and API docs: https://github.com/panva/openid-client (README "Supported
  Versions" lists v6.x only; CommonJS via `require(esm)` on ^20.19.0 || ^22.12.0 || >= 23.0.0)
- openid-client releases: https://github.com/panva/openid-client/releases (v6.0.0 breaking changes;
  v6.8.0 Retry-After in polling; v6.8.3 doc note on redirect_uri derivation; v6.8.8 default timeout
  and elapsed-time token lifetimes)
- jose releases: https://github.com/panva/jose/releases (v6.0.0 breaking changes)
- oauth4webapi: https://github.com/panva/oauth4webapi
- express-session README (`resave`, `saveUninitialized`, `regenerate`):
  https://github.com/expressjs/session

## Specifications

- RFC 9700, Best Current Practice for OAuth 2.0 Security (January 2025):
  https://www.rfc-editor.org/rfc/rfc9700 (2.1 exact redirect URI matching, CSRF, mix-up; 2.1.1 PKCE
  and transaction-specific challenge/nonce; 2.2.2 and 4.14.2 refresh token rotation and replay
  detection; 4.13 TLS terminating reverse proxies)
- The OAuth 2.1 Authorization Framework, draft-ietf-oauth-v2-1-17 (2026-10-31):
  https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/
- RFC 9207, OAuth 2.0 Authorization Server Issuer Identification (March 2022), section 2.4:
  https://www.rfc-editor.org/rfc/rfc9207
- RFC 9068, JWT Profile for OAuth 2.0 Access Tokens (October 2021), section 4 validation (typ,
  iss, aud, signature, exp, invalid_token): https://www.rfc-editor.org/rfc/rfc9068
- RFC 6750, Bearer Token Usage, section 3 (WWW-Authenticate, error codes):
  https://www.rfc-editor.org/rfc/rfc6750
- RFC 6749 section 6 (refresh: new refresh token replaces the old one) and 4.1.2 (code reuse):
  https://www.rfc-editor.org/rfc/rfc6749
- RFC 8725, JWT Best Current Practices (explicit typing, algorithm verification):
  https://www.rfc-editor.org/rfc/rfc8725
- OpenID Connect Core 1.0 errata set 2, 3.1.3.7 ID Token Validation (TLS in place of signature for
  token endpoint ID tokens; extra untrusted audiences; nonce):
  https://openid.net/specs/openid-connect-core-1_0-errata2.html
- OpenID Connect Back-Channel Logout 1.0, 2.4 and 2.6 (logout token claims and validation, typ
  `logout+jwt`): https://openid.net/specs/openid-connect-backchannel-1_0.html
- OpenID Connect RP-Initiated Logout 1.0: https://openid.net/specs/openid-connect-rpinitiated-1_0.html

## Behaviours verified by running them

openid-client 6.8.8:
- `import { Issuer, generators } from 'openid-client'` fails at load ("does not provide an export
  named 'Issuer'"); the v6 export list was read from the module.
- `discovery()` against an `http://` issuer throws `ClientError` `OAUTH_HTTP_REQUEST_FORBIDDEN`
  without `allowInsecureRequests`.
- With a client secret string the token request used `client_secret_post`;
  `ClientSecretBasic(secret)` switched it to `client_secret_basic`.
- `buildAuthorizationUrl` with an un-awaited `calculatePKCECodeChallenge` produced
  `code_challenge=[object Promise]`.
- Sending a nonce but omitting `expectedNonce` fails with `OAUTH_JWT_CLAIM_COMPARISON_FAILED`.
- ID tokens with wrong `aud`, wrong `iss`, wrong `nonce`, expired, `alg: none`, HS256 with the
  client secret (IdP advertises RS256/ES256) and an extra audience without `azp` were rejected; an
  ID token signed by a foreign key with valid claims was **accepted** by default and rejected after
  `enableNonRepudiationChecks`.
- A callback URL built from the request behind a TLS-terminating proxy (`req.protocol` + Host)
  produced `invalid_grant` at an IdP that compares `redirect_uri` exactly; building it from the
  registered redirect URI worked. Source: `stripParams(currentUrl)` in `authorizationCodeGrant`.
- Callback `iss` mismatch and missing `iss` (IdP advertises support) were rejected.
- Refresh errors: reused refresh token gave `ResponseBodyError` with `error: 'invalid_grant'`,
  status 400; a 503 JSON error gave `ClientError` `OAUTH_RESPONSE_IS_NOT_CONFORM`; a wrong client
  secret (401 with `WWW-Authenticate`) gave `WWWAuthenticateChallengeError`; a stopped IdP gave
  `TypeError: fetch failed` (cause `ECONNREFUSED`).

jose 6.2.14:
- `jwtVerify` without `requiredClaims: ['exp']` accepted a validly signed token with no `exp`.
- `typ: 'at+jwt'` accepted a token typed `application/at+jwt` and rejected `typ: JWT`.
- `alg: none`, HS256 keyed with the public key (PEM and JWK JSON) and a foreign key with a real
  `kid` were rejected with a remote JWKS.
- `createRemoteJWKSet` defaults (timeout 5 s, cooldown 30 s, cache 10 min, `redirect: 'manual'`,
  200 only) read from `dist/webapi/jwks/remote.js`; a key rotated in after the cooldown was picked
  up without a restart (Date mocked with `node:test` mock timers).

oauth4webapi 3.8.8 (source read, `build/index.js`): `validateJwtAccessToken` required claims and
`typ` check; JWKS cache age 300 s and unknown-`kid` refetch at age 60 s; ID token alg selection
order; `validateAuthResponse` iss and state handling.

Not verified here: provider-specific behaviour (Auth0, Okta, Entra ID, Keycloak, Cognito) such as
whether access tokens carry `typ: at+jwt`, `scope` vs `scp`, or refresh token grace periods. Check
the provider's documentation for those.
