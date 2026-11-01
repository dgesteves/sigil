# Authorization, cookies and forms

## Deny by default

```csharp
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie();
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("finance", p => p.RequireAuthenticatedUser().RequireRole("finance"))
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
```

| Endpoint metadata | Policy applied |
| --- | --- |
| none | `FallbackPolicy` (null by default = anonymous) |
| `RequireAuthorization()` or `[Authorize]` without a policy | `DefaultPolicy` (authenticated user) |
| `RequireAuthorization("finance")` | that policy |
| `AllowAnonymous()` | nothing, even with a fallback policy |

- With a fallback policy, every public endpoint needs `AllowAnonymous()`: health checks, the login
  page, the sign-in endpoint, the access-denied page, static or OpenAPI endpoints you serve.
- Group conventions (`app.MapGroup("/api").RequireAuthorization()`) protect what is mapped through
  that group. Endpoints mapped straight on `app` or by another module stay anonymous unless the
  fallback policy covers them.
- Roles come from `ClaimTypes.Role` claims on the identity. `RequireRole` is an OR over its arguments.
- Policy names are strings: keep them in one constants class.

## Cookie authentication on .NET 10

Before .NET 10, the cookie handler redirected every challenge to `LoginPath` (302) and every
forbid to `AccessDeniedPath`, except for requests with `X-Requested-With: XMLHttpRequest`. Since
.NET 10 it returns 401/403 for endpoints that carry `IDisableCookieRedirectMetadata`, which the
framework adds to `[ApiController]` actions, minimal API endpoints that read a JSON body or write a
JSON response, endpoints with `TypedResults` return types, and SignalR (documented). The `Location`
header is still set on those 401/403 responses.

Measured on 10.0.14 (signed-out `GET`, endpoint with `RequireAuthorization()`):

| Handler | Status |
| --- | --- |
| `() => TypedResults.Ok(dto)` | 401 |
| `Results<Ok<string>, NotFound> () => ...` | 401 |
| `() => new { a = 1 }` (POCO) | 401 |
| `(Dto body) => Results.Ok()` (JSON body) | 401 |
| `() => TypedResults.NoContent()` | 401 |
| `() => Results.Ok(dto)` | 302 |
| `() => Results.NoContent()` | 302 |
| `() => "text"` | 302 |
| `() => TypedResults.Text(csv, "text/csv")` | 302 |

Forbid (403 vs 302 to `AccessDeniedPath`) follows the same split.

Ways to make an API consistent:

1. **Mark the API surface**: `app.MapGroup("/api").DisableCookieRedirect()` (or on each module's
   group). Measured: every endpoint under the groups returned 401/403, including `Results.*`, string
   and CSV handlers. New endpoints outside those groups are not covered.
2. **Decide in the cookie events by path**, which covers endpoints regardless of how they are mapped:

   ```csharp
   options.Events.OnRedirectToLogin = ctx => RejectOrRedirect(ctx, StatusCodes.Status401Unauthorized);
   options.Events.OnRedirectToAccessDenied = ctx => RejectOrRedirect(ctx, StatusCodes.Status403Forbidden);

   static Task RejectOrRedirect(RedirectContext<CookieAuthenticationOptions> ctx, int status)
   {
       if (ctx.Request.Path.StartsWithSegments("/api")) ctx.Response.StatusCode = status;
       else ctx.Response.Redirect(ctx.RedirectUri);
       return Task.CompletedTask;
   }
   ```

   Setting the event replaces the framework's metadata check, so the `else` branch must redirect.
3. Converting every handler to typed JSON results also works, except text/HTML results.

Then give the empty 401/403 a body: `UseStatusCodePages()` placed before `UseAuthentication()`,
with `AddProblemDetails()`, or write a problem in the event through `IProblemDetailsService`:

```csharp
ctx.Response.StatusCode = status;
await ctx.HttpContext.RequestServices.GetRequiredService<IProblemDetailsService>()
    .WriteAsync(new() { HttpContext = ctx.HttpContext, ProblemDetails = { Status = status } });
```

Other switches: `.AllowCookieRedirect()` / `[AllowCookieRedirect]` restores redirects for one
endpoint; the AppContext switch `Microsoft.AspNetCore.Authentication.Cookies.IgnoreRedirectMetadata`
restores the pre-.NET 10 behaviour for the whole app.

Cookie options worth setting for a same-site SPA: `Cookie.HttpOnly = true`,
`Cookie.SecurePolicy = CookieSecurePolicy.Always` in production, `Cookie.SameSite = Lax` (or
`Strict`), and a sliding expiry. Sign in with `HttpContext.SignInAsync(scheme, principal)`; build the
`ClaimsIdentity` with an `authenticationType` (the scheme name is the usual choice), or
`IsAuthenticated` is false.

## Bearer tokens

`Microsoft.AspNetCore.Authentication.JwtBearer` is a NuGet package, not part of the shared
framework. Bearer challenges are always 401/403 (no redirects). Validate issuer, audience, lifetime
and signing key; don't turn `ValidateAudience` off to make a token work. In tests, register a test
authentication handler instead of minting real tokens.

## Forms and antiforgery

- Endpoints that bind `[FromForm]` parameters, `IFormFile`, `IFormFileCollection` or
  `IFormCollection` get antiforgery metadata automatically (.NET 8+).
- They need `builder.Services.AddAntiforgery()` and `app.UseAntiforgery()`, placed after
  `UseAuthentication()`/`UseAuthorization()`. With neither, or with only `AddAntiforgery()`, the
  request fails with 500 `InvalidOperationException: Endpoint ... contains anti-forgery metadata, but
  a middleware was not found that supports anti-forgery` (measured).
- With the middleware, a post without a valid token is a 400 (measured). Render the token with
  `IAntiforgery.GetAndStoreTokens(httpContext)` into the form.
- `.DisableAntiforgery()` is for endpoints that are not cookie-authenticated (webhooks with a
  signature, token-authenticated uploads). Never for browser forms with a session cookie.
