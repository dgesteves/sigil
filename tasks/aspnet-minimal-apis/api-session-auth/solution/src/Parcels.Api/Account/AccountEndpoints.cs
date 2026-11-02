using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Parcels.Api.Account;

public sealed record SignInRequest(string? UserName, string? Password);

public static class AccountEndpoints
{
    /// <summary>Server-rendered pages for staff who use the browser directly.</summary>
    public static IEndpointRouteBuilder MapAccountPages(this IEndpointRouteBuilder app)
    {
        var pages = app.MapGroup("/account");

        pages.MapGet("/login", () => Html("Sign in", """
            <form id="login">
              <label>User <input name="userName" autocomplete="username"></label>
              <label>Password <input name="password" type="password" autocomplete="current-password"></label>
              <button>Sign in</button>
            </form>
            <script>
              document.getElementById('login').addEventListener('submit', async (e) => {
                e.preventDefault();
                const form = new FormData(e.target);
                const res = await fetch('/api/session', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(Object.fromEntries(form)),
                });
                if (res.ok) location.href = new URLSearchParams(location.search).get('ReturnUrl') ?? '/account/profile';
              });
            </script>
            """)).AllowAnonymous();

        pages.MapGet("/denied", () => Html("Access denied", "<p>You don't have access to that page.</p>"))
            .AllowAnonymous();

        pages.MapGet("/profile", (ClaimsPrincipal user) =>
                Html("Profile", $"<p>Signed in as {WebUtility.HtmlEncode(user.Identity?.Name)}.</p>"))
            .RequireAuthorization();

        pages.MapGet("/admin", () => Html("Admin", "<p>Refunds and reports.</p>"))
            .RequireAuthorization(Policies.Admin);

        return app;
    }

    /// <summary>JSON session endpoints used by the SPA.</summary>
    public static IEndpointRouteBuilder MapSessionApi(this IEndpointRouteBuilder app)
    {
        var session = app.MapGroup("/api/session");

        session.MapPost("/", SignIn).AllowAnonymous();
        session.MapDelete("/", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });
        session.MapGet("/me", (ClaimsPrincipal user) => Results.Ok(new
        {
            userName = user.Identity?.Name,
            roles = user.FindAll(ClaimTypes.Role).Select(c => c.Value).ToArray(),
        }));

        return app;
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> SignIn(
        SignInRequest request,
        UserDirectory users,
        HttpContext http)
    {
        if (users.Verify(request.UserName, request.Password) is not { } user)
            return TypedResults.Problem(title: "Invalid user name or password", statusCode: StatusCodes.Status401Unauthorized);

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.Name, user.UserName),
                new Claim("display_name", user.DisplayName),
                .. user.Roles.Select(role => new Claim(ClaimTypes.Role, role)),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme);
        await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
        return TypedResults.NoContent();
    }

    private static ContentHttpResult Html(string title, string body) => TypedResults.Content(
        $"<!doctype html><html><head><title>{title}</title></head><body><h1>{title}</h1>{body}</body></html>",
        "text/html; charset=utf-8");
}
