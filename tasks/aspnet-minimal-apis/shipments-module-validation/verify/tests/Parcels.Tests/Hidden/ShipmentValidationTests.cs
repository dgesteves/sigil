using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Parcels.Shipments;

namespace Parcels.Tests.Hidden;

public class ShipmentValidationTests(ParcelsApiFactory factory) : IClassFixture<ParcelsApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static JsonObject Address(string countryCode = "PT") => new()
    {
        ["name"] = "Receiving dock",
        ["line1"] = "Rua de Santa Catarina 200",
        ["line2"] = "Armazem B",
        ["city"] = "Porto",
        ["postcode"] = "4000-442",
        ["countryCode"] = countryCode,
    };

    private static JsonObject Parcel(int weight = 2000, int side = 40) => new()
    {
        ["weightGrams"] = weight, ["lengthCm"] = side, ["widthCm"] = 30, ["heightCm"] = 20,
    };

    private static JsonObject Valid() => new()
    {
        ["customerId"] = Guid.NewGuid().ToString(),
        ["service"] = "same-day",
        ["pickup"] = Address(),
        ["delivery"] = Address("ES"),
        ["parcels"] = new JsonArray(Parcel(), Parcel(500, 10)),
        ["pickupWindow"] = new JsonObject
        {
            ["from"] = "2026-11-03T09:00:00+00:00",
            ["to"] = "2026-11-03T12:00:00+00:00",
        },
        ["reference"] = "PO-2026-0042",
    };

    private async Task<HttpResponseMessage> Book(JsonNode body) =>
        await factory.CreateClient().PostAsJsonAsync("/api/shipments", body, Ct);

    private async Task<int> CountShipments() =>
        (await factory.CreateClient().GetFromJsonAsync<List<Shipment>>("/api/shipments", Ct))!.Count;

    [Fact]
    public async Task A_valid_booking_is_accepted()
    {
        Assert.Equal(HttpStatusCode.Created, (await Book(Valid())).StatusCode);

        var minimal = Valid();
        minimal.Remove("pickupWindow");
        minimal.Remove("reference");
        minimal["pickup"]!.AsObject().Remove("name");
        minimal["pickup"]!.AsObject().Remove("line2");
        minimal["parcels"] = new JsonArray(Parcel(30000, 150));
        Assert.Equal(HttpStatusCode.Created, (await Book(minimal)).StatusCode);
    }

    [Fact]
    public async Task An_empty_booking_reports_every_required_field_and_stores_nothing()
    {
        var before = await CountShipments();
        var problem = await ValidationProblem.ReadAsync(await Book(new JsonObject()));
        problem.Has("customerId", "service", "pickup", "delivery", "parcels");
        Assert.Equal(before, await CountShipments());
    }

    [Theory]
    [InlineData("overnight")]
    [InlineData("")]
    public async Task Service_must_be_a_known_service(string service)
    {
        var body = Valid();
        body["service"] = service;
        var problem = await ValidationProblem.ReadAsync(await Book(body));
        problem.Has("service");
        problem.Lacks("customerId", "pickup", "delivery", "parcels");
    }

    [Fact]
    public async Task Addresses_are_validated_field_by_field()
    {
        var body = Valid();
        body["pickup"] = new JsonObject { ["name"] = new string('n', 101), ["city"] = "Porto", ["postcode"] = "4000-442-0001" };
        body["delivery"]!["countryCode"] = "es";
        var problem = await ValidationProblem.ReadAsync(await Book(body));
        problem.Has("pickup.name", "pickup.line1", "pickup.postcode", "pickup.countryCode", "delivery.countryCode");
        problem.Lacks("pickup.city", "delivery.line1", "delivery.postcode", "service");
    }

    [Fact]
    public async Task Parcels_are_validated_by_index()
    {
        var body = Valid();
        body["parcels"] = new JsonArray(Parcel(), Parcel(0), Parcel(30001), Parcel(1000, 151));
        var problem = await ValidationProblem.ReadAsync(await Book(body));
        problem.Has("parcels[1].weightGrams", "parcels[2].weightGrams", "parcels[3].lengthCm");
        problem.Lacks("parcels[0].weightGrams", "parcels[0].lengthCm", "parcels[3].weightGrams");
    }

    [Fact]
    public async Task Between_one_and_twenty_parcels()
    {
        var none = Valid();
        none["parcels"] = new JsonArray();
        (await ValidationProblem.ReadAsync(await Book(none))).Has("parcels");

        var many = Valid();
        var parcels = new JsonArray();
        for (var i = 0; i < 21; i++) parcels.Add(Parcel());
        many["parcels"] = parcels;
        (await ValidationProblem.ReadAsync(await Book(many))).Has("parcels");

        parcels.RemoveAt(20);
        Assert.Equal(HttpStatusCode.Created, (await Book(many)).StatusCode);
    }

    [Fact]
    public async Task The_pickup_window_must_end_after_it_starts()
    {
        var backwards = Valid();
        backwards["pickupWindow"] = new JsonObject
        {
            ["from"] = "2026-11-03T12:00:00+00:00",
            ["to"] = "2026-11-03T09:00:00+00:00",
        };
        var problem = await ValidationProblem.ReadAsync(await Book(backwards));
        Assert.Contains(problem.Errors.Keys, k => k.StartsWith("pickupWindow", StringComparison.OrdinalIgnoreCase));
        problem.Lacks("service", "parcels", "pickup", "delivery");

        var empty = Valid();
        empty["pickupWindow"] = new JsonObject
        {
            ["from"] = "2026-11-03T12:00:00+00:00",
            ["to"] = "2026-11-03T12:00:00+00:00",
        };
        await ValidationProblem.ReadAsync(await Book(empty));

        var half = Valid();
        half["pickupWindow"] = new JsonObject { ["from"] = "2026-11-03T12:00:00+00:00" };
        (await ValidationProblem.ReadAsync(await Book(half))).Has("pickupWindow.to");
    }

    [Fact]
    public async Task Reference_is_at_most_35_characters()
    {
        var body = Valid();
        body["reference"] = new string('R', 36);
        (await ValidationProblem.ReadAsync(await Book(body))).Has("reference");

        body["reference"] = new string('R', 35);
        Assert.Equal(HttpStatusCode.Created, (await Book(body)).StatusCode);
    }

    [Theory]
    [InlineData("/api/shipments/quote?weightGrams=0&service=standard", "weightGrams")]
    [InlineData("/api/shipments/quote?weightGrams=30001&service=express", "weightGrams")]
    [InlineData("/api/shipments/quote?weightGrams=1000&service=overnight", "service")]
    public async Task Quote_parameters_are_validated(string url, string field)
    {
        var response = await factory.CreateClient().GetAsync(url, Ct);
        (await ValidationProblem.ReadAsync(response)).Has(field);
    }

    [Fact]
    public async Task Valid_quotes_still_work()
    {
        var quote = await factory.CreateClient().GetFromJsonAsync<Quote>(
            "/api/shipments/quote?weightGrams=30000&service=same-day", Ct);
        Assert.Equal(1590 + 210 * 30, quote!.PriceCents);
    }

    [Fact]
    public async Task Customer_validation_keeps_working()
    {
        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/customers", new { name = new string('x', 101), email = "ana@example.com", phone = "not a phone!" }, Ct);
        var problem = await ValidationProblem.ReadAsync(response);
        problem.Has("name", "phone");
        problem.Lacks("email");
    }
}
