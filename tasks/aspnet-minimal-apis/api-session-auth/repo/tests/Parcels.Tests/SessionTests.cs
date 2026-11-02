using System.Net;
using System.Net.Http.Json;
using Parcels.Api.Customers;

namespace Parcels.Tests;

public class SessionTests(ParcelsApiFactory factory) : IClassFixture<ParcelsApiFactory>
{
    [Fact]
    public async Task Signing_in_sets_a_session_cookie()
    {
        var client = factory.Browser();
        var response = await client.PostAsJsonAsync(
            "/api/session", new { userName = "rui", password = "rui-demo-password" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("parcels.session="));
    }

    [Fact]
    public async Task Wrong_password_is_rejected()
    {
        var response = await factory.Browser().PostAsJsonAsync(
            "/api/session", new { userName = "rui", password = "nope" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Signed_in_staff_can_use_the_api()
    {
        var client = await factory.SignedIn("rui");
        var ct = TestContext.Current.CancellationToken;

        var customers = await client.GetFromJsonAsync<List<Customer>>("/api/customers", ct);
        Assert.NotNull(customers);
        Assert.Contains(customers, c => c.Id == CustomerStore.SeedCustomerA);

        var shipments = await client.GetAsync("/api/shipments", ct);
        Assert.Equal(HttpStatusCode.OK, shipments.StatusCode);
    }

    [Fact]
    public async Task Admins_can_refund()
    {
        var client = await factory.SignedIn("ana");
        var response = await client.PostAsJsonAsync(
            "/api/shipments/SHP-1002/refund", new { amountCents = 100, reason = "late" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Profile_page_redirects_to_login_when_signed_out()
    {
        var response = await factory.Browser().GetAsync("/account/profile", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.StartsWith("/account/login", response.Headers.Location!.PathAndQuery);
    }
}
