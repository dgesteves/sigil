using System.Net;
using System.Net.Http.Json;
using Parcels.Shipments;

namespace Parcels.Tests;

public class ShipmentTests(ParcelsApiFactory factory) : IClassFixture<ParcelsApiFactory>
{
    private static object Booking() => new
    {
        customerId = Guid.NewGuid(),
        service = "express",
        pickup = new { name = "Warehouse 3", line1 = "Rua do Ouro 1", city = "Lisboa", postcode = "1100-060", countryCode = "PT" },
        delivery = new { line1 = "Calle Mayor 5", city = "Madrid", postcode = "28013", countryCode = "ES" },
        parcels = new[] { new { weightGrams = 1200, lengthCm = 30, widthCm = 20, heightCm = 10 } },
        reference = "PO-7781",
    };

    [Fact]
    public async Task Books_a_shipment_and_reads_it_back()
    {
        var client = factory.CreateClient();
        var ct = TestContext.Current.CancellationToken;
        var response = await client.PostAsJsonAsync("/api/shipments", Booking(), ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var shipment = await response.Content.ReadFromJsonAsync<Shipment>(ct);
        Assert.Equal(890 + 150 * 2, shipment!.PriceCents);

        var fetched = await client.GetFromJsonAsync<Shipment>($"/api/shipments/{shipment.Id}", ct);
        Assert.Equal("PO-7781", fetched!.Reference);
    }

    [Fact]
    public async Task Quotes_a_price()
    {
        var quote = await factory.CreateClient().GetFromJsonAsync<Quote>(
            "/api/shipments/quote?weightGrams=2500&service=standard", TestContext.Current.CancellationToken);
        Assert.Equal(450 + 90 * 3, quote!.PriceCents);
    }
}
