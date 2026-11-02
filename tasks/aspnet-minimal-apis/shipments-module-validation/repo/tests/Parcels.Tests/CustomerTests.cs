using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Parcels.Tests;

public class CustomerTests(ParcelsApiFactory factory) : IClassFixture<ParcelsApiFactory>
{
    [Fact]
    public async Task Creates_a_customer()
    {
        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/customers", new { name = "Livraria Lello", email = "orders@lello.example" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Invalid_customers_get_a_validation_problem()
    {
        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/customers", new { name = "", email = "not-an-email" },
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var fields = problem.RootElement.GetProperty("errors").EnumerateObject().Select(p => p.Name.ToLowerInvariant());
        Assert.Equal(["email", "name"], fields.Order());
    }
}
