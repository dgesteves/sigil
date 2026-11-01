using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Parcels.Tests;

public sealed class ParcelsApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseEnvironment("Production");

    /// <summary>A client that keeps cookies and does not follow redirects.</summary>
    public HttpClient Browser() =>
        CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });

    public async Task<HttpClient> SignedIn(string userName)
    {
        var client = Browser();
        var response = await client.PostAsJsonAsync(
            "/api/session", new { userName, password = $"{userName}-demo-password" });
        response.EnsureSuccessStatusCode();
        return client;
    }
}
