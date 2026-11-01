using Microsoft.AspNetCore.Authentication.Cookies;
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
    });
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => TypedResults.Ok(new { status = "ok" }));
app.MapGet("/api/version", () => "parcels-api 2.14.0");

app.MapAccountPages();
app.MapSessionApi();
app.MapCustomers();
app.MapShipments();
app.MapReports();

app.Run();

public partial class Program;
