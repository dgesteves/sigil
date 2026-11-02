# Token lifecycle: storing, refreshing, logging out

Checked against openid-client 6.8.8 with a local IdP that rotates refresh tokens and revokes the
whole grant on reuse (the RFC 9700 section 4.14.2 behaviour), with sessions in a store that copies
values and adds a network round trip, as Redis does.

## Where tokens live

| Client | Access / refresh tokens | Browser holds |
| --- | --- | --- |
| Server-rendered app or BFF | server-side session store, keyed by an opaque session id | `HttpOnly; Secure; SameSite=Lax` session cookie only |
| SPA without a BFF | memory (access), refresh only if the IdP rotates and binds it; prefer a BFF | n/a |
| Machine-to-machine | process memory, cached until shortly before expiry | n/a |

A session record that works well: `{ user, tokens: { accessToken, refreshToken, idToken, expiresAt } }`
with `expiresAt` in epoch milliseconds computed when the token response arrives.

## Refresh: the sequence that works

```
request -> read session -> fresh enough? -> use access token
                       \-> expiring -> join or start the single flight for this session
                                         -> re-read session (someone may have refreshed)
                                         -> still expiring? refreshTokenGrant(rt)
                                         -> write { new at, new rt ?? old rt, id_token ?? old, expiresAt }
                                         -> settle; remove the flight (also on failure)
```

Failure handling:

| Outcome of `refreshTokenGrant` | Meaning | Do |
| --- | --- | --- |
| `ResponseBodyError`, `error === 'invalid_grant'` | refresh token expired, revoked, or reused | delete the session, answer 401 / redirect to sign-in, never retry |
| `ResponseBodyError`, other `error` (`invalid_scope`, `unauthorized_client`) | request or client config is wrong | log, alert, treat as signed out for the user |
| `WWWAuthenticateChallengeError` (401) | client authentication failed | configuration problem: alert; keep sessions |
| `ClientError` `OAUTH_RESPONSE_IS_NOT_CONFORM` | IdP answered 5xx or another unexpected status | transient: keep the session, 503, retry on a later request |
| `TypeError` (`fetch failed`), timeout | network | transient, as above |

Retry a transient failure with the **same** refresh token only if you know the IdP did not process
the first request. When in doubt, do not retry inside the request; the next request will try again.

## Variants of the single flight

**Promise per session (one process).** Shown in SKILL.md. Delete the entry in `finally`; a cached
rejected promise wedges the session until restart.

**Per-session mutex.** Chain each caller onto the previous one and do *both* the expiry check and
the refresh inside the lock, reading the session fresh. Locking only the refresh call is not enough:
callers that read the old session before taking the lock still send the old refresh token.

```ts
const tails = new Map<string, Promise<unknown>>()
function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(work)
  const tail = run.catch(() => {})
  tails.set(key, tail)
  void tail.then(() => tails.get(key) === tail && tails.delete(key))
  return run
}
```

**Several instances.** In-process maps do not see each other. Options, in order of preference:
1. Route a session to one instance (sticky sessions) and keep the in-process flight.
2. A distributed lock per session (`SET lock:<sid> <token> NX PX 10000` in Redis), then re-read the
   session; waiters poll the session for a newer `expiresAt` instead of refreshing.
3. If your IdP offers a reuse or grace interval for the previous refresh token, enable a short one
   as a safety net, not as the mechanism.

**Reactive refresh on 401.** If the API rejects a token that should still be valid (revoked
early, clock skew), refresh once through the same single flight and retry the call once. Never
loop.

**Multiple tabs of a SPA** have the same problem in the browser; use the BFF, or the Web Locks API
(`navigator.locks.request`) around the refresh.

## Client credentials (service to service)

Cache the token per audience and scope until `expiresAt - skew`, and share the in-flight request,
exactly like a refresh. Fetching a token per outgoing call gets you rate limited by the IdP.

```ts
let cached: { token: string; expiresAt: number } | undefined
let inFlightToken: Promise<string> | undefined
export async function serviceToken(): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token
  // Assign synchronously: an `await` before the assignment would let a second caller start a
  // second grant.
  inFlightToken ??= (async () => {
    const t = await oidc.clientCredentialsGrant(await idp(), { scope: 'reports:read' })
    cached = { token: t.access_token, expiresAt: Date.now() + (t.expiresIn() ?? 60) * 1000 }
    return t.access_token
  })().finally(() => {
    inFlightToken = undefined
  })
  return inFlightToken
}
```

## Logout

RP-initiated logout (OpenID Connect RP-Initiated Logout 1.0):

1. Read the ID token from the session, then destroy the session in the store.
2. Clear the cookie.
3. Redirect to `buildEndSessionUrl(config, { id_token_hint, post_logout_redirect_uri, state? })`.
   `post_logout_redirect_uri` must be registered; `client_id` is added for you.

Back-channel logout (OpenID Connect Back-Channel Logout 1.0), if the IdP calls your
`backchannel_logout_uri` with a `logout_token`: validate it like an ID token (signature against the
IdP JWKS with the ID token algorithms, never `none`; `iss`, `aud`, `iat`, `exp`), require `sub` or
`sid`, require `events` with the member `http://schemas.openid.net/event/backchannel-logout`,
reject it if it contains `nonce`, optionally reject a repeated `jti`, and expect `typ: logout+jwt`
when the IdP sets it. Then delete every session for that `sid` or `sub` and answer 200 (400 on any
validation failure). With jose:

```ts
const { payload } = await jwtVerify(logoutToken, idpKeys, {
  issuer, audience: clientId, algorithms: ['RS256'], requiredClaims: ['iat', 'exp', 'jti', 'events'],
})
const events = payload.events as Record<string, unknown> | undefined
if (!events?.['http://schemas.openid.net/event/backchannel-logout'] || 'nonce' in payload) throw new Error('not a logout token')
if (!payload.sub && !payload.sid) throw new Error('logout token names no session')
```

## Revocation

`tokenRevocation(config, refreshToken)` (RFC 7009) on logout stops a leaked refresh token from
outliving the session, where the IdP supports it (`revocation_endpoint` in discovery). Access tokens
that are JWTs stay valid until `exp`: keep them short-lived (5 to 15 minutes).
