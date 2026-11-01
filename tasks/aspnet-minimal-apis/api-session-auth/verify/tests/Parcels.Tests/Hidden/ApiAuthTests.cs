using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Parcels.Api.Customers;
using Parcels.Api.Shipments;

namespace Parcels.Tests.Hidden;

public class ApiAuthTests(ParcelsApiFactory factory) : IClassFixture<ParcelsApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    // Every /api endpoint except signing in. Ids are the store seeds.
    public static TheoryData<string, string> ProtectedApi => new()
    {
        { "GET", "/api/version" },
        { "GET", "/api/session/me" },
        { "DELETE", "/api/session" },
        { "GET", "/api/customers" },
        { "GET", $"/api/customers/{CustomerStore.SeedCustomerB}" },
        { "POST", "/api/customers" },
        { "DELETE", $"/api/customers/{CustomerStore.SeedCustomerB}" },
        { "GET", "/api/shipments" },
        { "GET", $"/api/shipments/{ShipmentStore.SeedShipment}" },
        { "POST", $"/api/shipments/{ShipmentStore.SeedShipment}/refund" },
        { "GET", "/api/reports/daily" },
    };

    public static TheoryData<string, string> AdminOnlyApi => new()
    {
        { "DELETE", $"/api/customers/{CustomerStore.SeedCustomerB}" },
        { "POST", $"/api/shipments/{ShipmentStore.SeedShipment}/refund" },
        { "GET", "/api/reports/daily" },
    };

    private static HttpRequestMessage Request(string method, string path)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method is "POST" or "PUT")
            request.Content = path.EndsWith("/refund")
                ? JsonContent.Create(new { amountCents = 50, reason = "damaged" })
                : JsonContent.Create(new { name = "Probe Lda", email = "probe@example.com" });
        return request;
    }

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode expected)
    {
        var body = await response.Content.ReadAsStringAsync(Ct);
        Assert.True(
            response.StatusCode == expected,
            $"{response.RequestMessage?.Method} {response.RequestMessage?.RequestUri?.PathAndQuery}: expected {(int)expected}, got {(int)response.StatusCode} {response.Headers.Location} {body}");
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = System.Text.Json.JsonDocument.Parse(body);
        Assert.Equal((int)expected, doc.RootElement.GetProperty("status").GetInt32());
    }

    [Theory]
    [MemberData(nameof(ProtectedApi))]
    public async Task Signed_out_api_calls_get_401_problem_details(string method, string path)
    {
        var response = await factory.Browser().SendAsync(Request(method, path), Ct);
        await AssertProblem(response, HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Every_mapped_api_endpoint_requires_sign_in()
    {
        var sources = factory.Services.GetRequiredService<EndpointDataSource>();
        var client = factory.Browser();
        var checkedCount = 0;
        foreach (var endpoint in sources.Endpoints.OfType<RouteEndpoint>())
        {
            var pattern = "/" + (endpoint.RoutePattern.RawText ?? "").TrimStart('/');
            if (!pattern.StartsWith("/api", StringComparison.OrdinalIgnoreCase)) continue;
            var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["GET"];
            foreach (var method in methods)
            {
                if (method == "POST" && pattern.TrimEnd('/') == "/api/session") continue;
                var path = pattern
                    .Replace("{id:guid}", CustomerStore.SeedCustomerB.ToString())
                    .Replace("{id}", ShipmentStore.SeedShipment);
                if (path.Contains('{')) path = System.Text.RegularExpressions.Regex.Replace(path, "{[^}]+}", "x");
                var response = await client.SendAsync(Request(method, path), Ct);
                Assert.True(
                    response.StatusCode is HttpStatusCode.Unauthorized,
                    $"{method} {pattern} answered {(int)response.StatusCode} {response.Headers.Location} to a signed-out caller");
                checkedCount++;
            }
        }
        Assert.True(checkedCount >= 11, $"only found {checkedCount} /api endpoints");
    }

    [Theory]
    [MemberData(nameof(AdminOnlyApi))]
    public async Task Staff_without_the_admin_role_get_403_problem_details(string method, string path)
    {
        var clerk = await factory.SignedIn("rui");
        var response = await clerk.SendAsync(Request(method, path), Ct);
        await AssertProblem(response, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Clerks_keep_their_everyday_endpoints()
    {
        var clerk = await factory.SignedIn("rui");
        foreach (var (method, path) in new[]
                 {
                     ("GET", "/api/version"), ("GET", "/api/session/me"), ("GET", "/api/customers"),
                     ("GET", $"/api/customers/{CustomerStore.SeedCustomerA}"), ("POST", "/api/customers"),
                     ("GET", "/api/shipments"), ("GET", $"/api/shipments/{ShipmentStore.SeedShipment}"),
                 })
        {
            var response = await clerk.SendAsync(Request(method, path), Ct);
            Assert.True(response.IsSuccessStatusCode, $"clerk {method} {path} answered {(int)response.StatusCode}");
        }
    }

    [Fact]
    public async Task Admins_can_use_the_admin_endpoints()
    {
        var admin = await factory.SignedIn("ana");
        var customer = await (await admin.PostAsJsonAsync(
            "/api/customers", new { name = "To Erase", email = "erase@example.com" }, Ct))
            .Content.ReadFromJsonAsync<Customer>(Ct);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/customers/{customer!.Id}", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.SendAsync(Request("POST", "/api/shipments/SHP-1002/refund"), Ct)).StatusCode);

        var report = await admin.GetAsync("/api/reports/daily", Ct);
        Assert.Equal(HttpStatusCode.OK, report.StatusCode);
        Assert.Equal("text/csv", report.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Public_endpoints_stay_public()
    {
        var client = factory.Browser();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health", Ct)).StatusCode);
        var login = await client.GetAsync("/account/login", Ct);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Equal("text/html", login.Content.Headers.ContentType?.MediaType);
        var signIn = await client.PostAsJsonAsync("/api/session", new { userName = "ana", password = "ana-demo-password" }, Ct);
        Assert.Equal(HttpStatusCode.NoContent, signIn.StatusCode);
    }

    [Fact]
    public async Task Account_pages_keep_redirecting()
    {
        var anonymous = await factory.Browser().GetAsync("/account/profile", Ct);
        Assert.Equal(HttpStatusCode.Redirect, anonymous.StatusCode);
        Assert.Equal("/account/login", anonymous.Headers.Location!.AbsolutePath);
        Assert.Contains("ReturnUrl=%2Faccount%2Fprofile", anonymous.Headers.Location.Query);

        var clerk = await factory.SignedIn("rui");
        Assert.Equal(HttpStatusCode.OK, (await clerk.GetAsync("/account/profile", Ct)).StatusCode);
        var denied = await clerk.GetAsync("/account/admin", Ct);
        Assert.Equal(HttpStatusCode.Redirect, denied.StatusCode);
        Assert.Equal("/account/denied", denied.Headers.Location!.AbsolutePath);

        var admin = await factory.SignedIn("ana");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/account/admin", Ct)).StatusCode);
    }

    [Fact]
    public async Task Endpoints_without_their_own_rules_require_a_signed_in_user()
    {
        // What an endpoint added later with no authorization metadata gets: the fallback policy.
        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider.GetRequiredService<IAuthorizationPolicyProvider>();
        var authorization = scope.ServiceProvider.GetRequiredService<IAuthorizationService>();
        var fallback = await provider.GetFallbackPolicyAsync();
        Assert.True(fallback is not null, "no default (fallback) authorization policy: endpoints are anonymous unless each one opts in");

        var anonymous = new ClaimsPrincipal(new ClaimsIdentity());
        Assert.False((await authorization.AuthorizeAsync(anonymous, null, fallback)).Succeeded);

        var clerk = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, "rui"), new Claim(ClaimTypes.Role, "clerk")],
            CookieAuthenticationDefaults.AuthenticationScheme));
        Assert.True((await authorization.AuthorizeAsync(clerk, null, fallback)).Succeeded);
    }
}
