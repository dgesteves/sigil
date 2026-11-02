using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Parcels.Api.Account;
using Parcels.Api.Customers;
using Parcels.Api.Reports;
using Parcels.Api.Shipments;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<UserDirectory>();
builder.Services.AddSingleton<CustomerStore>();
builder.Services.AddSingleton<ShipmentStore>();

// One cookie session for the server-rendered account pages and the SPA's /api calls.
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "parcels.session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.LoginPath = "/account/login";
        options.AccessDeniedPath = "/account/denied";
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;

        // .NET 10 already answers 401/403 instead of redirecting, but only for endpoints it
        // recognises as APIs (IApiEndpointMetadata: JSON bodies, TypedResults return types).
        // Handlers returning IResult or a string still get the login redirect, so decide by path.
        options.Events.OnRedirectToLogin = context => StatusOrRedirect(context, StatusCodes.Status401Unauthorized);
        options.Events.OnRedirectToAccessDenied = context => StatusOrRedirect(context, StatusCodes.Status403Forbidden);
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.Admin, policy => policy.RequireAuthenticatedUser().RequireRole("admin"))
    // Deny by default: an endpoint without its own authorization metadata needs a signed-in user.
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

var app = builder.Build();

app.UseExceptionHandler();
// Writes problem details bodies for the empty 401/403 (and 404) responses.
app.UseStatusCodePages();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => TypedResults.Ok(new { status = "ok" })).AllowAnonymous();
app.MapGet("/api/version", () => "parcels-api 2.14.0");

app.MapAccountPages();
app.MapSessionApi();
app.MapCustomers();
app.MapShipments();
app.MapReports();

app.Run();

static Task StatusOrRedirect(Microsoft.AspNetCore.Authentication.RedirectContext<CookieAuthenticationOptions> context, int status)
{
    if (context.Request.Path.StartsWithSegments("/api"))
        context.Response.StatusCode = status;
    else
        context.Response.Redirect(context.RedirectUri);
    return Task.CompletedTask;
}

public static class Policies
{
    public const string Admin = "admin";
}

public partial class Program;
