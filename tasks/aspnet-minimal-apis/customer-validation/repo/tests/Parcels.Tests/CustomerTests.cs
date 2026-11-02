using System.Net;
using System.Net.Http.Json;
using Parcels.Api.Customers;

namespace Parcels.Tests;

public class CustomerTests(ParcelsApiFactory factory) : IClassFixture<ParcelsApiFactory>
{
    private static object ValidCustomer(string name = "Ana Ribeiro") => new
    {
        name,
        email = "ana.ribeiro@example.com",
        phone = "+351 210 000 000",
        billingAddress = new
        {
            line1 = "Rua Augusta 100",
            city = "Lisboa",
            postcode = "1100-053",
            countryCode = "PT",
        },
        contacts = new[] { new { name = "Rui Costa", email = "rui.costa@example.com" } },
    };

    [Fact]
    public async Task Creates_a_customer_and_reads_it_back()
    {
        var client = factory.CreateClient();
        var ct = TestContext.Current.CancellationToken;

        var created = await client.PostAsJsonAsync("/api/customers", ValidCustomer(), ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var customer = await created.Content.ReadFromJsonAsync<Customer>(ct);
        Assert.NotNull(customer);
        Assert.Equal($"/api/customers/{customer.Id}", created.Headers.Location?.OriginalString);

        var fetched = await client.GetFromJsonAsync<Customer>($"/api/customers/{customer.Id}", ct);
        Assert.Equal("Ana Ribeiro", fetched?.Name);
        Assert.Equal("PT", fetched?.BillingAddress.CountryCode);
    }

    [Fact]
    public async Task Unknown_customer_is_404()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync(
            $"/api/customers/{Guid.NewGuid()}", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Lists_customers_in_pages()
    {
        var client = factory.CreateClient();
        var ct = TestContext.Current.CancellationToken;
        for (var i = 0; i < 3; i++)
            (await client.PostAsJsonAsync("/api/customers", ValidCustomer($"Paged {i}"), ct))
                .EnsureSuccessStatusCode();

        var page = await client.GetFromJsonAsync<PagedList<Customer>>("/api/customers?page=1&pageSize=2", ct);
        Assert.NotNull(page);
        Assert.Equal(2, page.Items.Count);
        Assert.True(page.Total >= 3);
    }
}
