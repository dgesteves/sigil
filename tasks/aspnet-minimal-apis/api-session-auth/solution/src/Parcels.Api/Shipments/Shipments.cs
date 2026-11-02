using System.Collections.Concurrent;

namespace Parcels.Api.Shipments;

public record Shipment(string Id, Guid CustomerId, string Status, long PriceCents, long RefundedCents);

public sealed record RefundRequest(long AmountCents, string Reason);

public sealed class ShipmentStore
{
    public const string SeedShipment = "SHP-1001";

    private readonly ConcurrentDictionary<string, Shipment> _shipments = new()
    {
        [SeedShipment] = new(SeedShipment, Customers.CustomerStore.SeedCustomerA, "delivered", 1290, 0),
        ["SHP-1002"] = new("SHP-1002", Customers.CustomerStore.SeedCustomerB, "in_transit", 870, 0),
    };

    public IReadOnlyList<Shipment> All() => _shipments.Values.OrderBy(s => s.Id).ToList();
    public Shipment? Find(string id) => _shipments.GetValueOrDefault(id);

    public Shipment? Refund(string id, long amountCents)
    {
        if (!_shipments.TryGetValue(id, out var shipment)) return null;
        var refunded = shipment with { RefundedCents = Math.Min(shipment.PriceCents, shipment.RefundedCents + amountCents) };
        _shipments[id] = refunded;
        return refunded;
    }
}

public static class ShipmentEndpoints
{
    public static RouteGroupBuilder MapShipments(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/shipments");

        group.MapGet("/", (ShipmentStore store) => Results.Ok(store.All()));

        group.MapGet("/{id}", (string id, ShipmentStore store) =>
            store.Find(id) is { } shipment ? Results.Ok(shipment) : Results.NotFound());

        // Money leaves the company here: admins only.
        group.MapPost("/{id}/refund", (string id, RefundRequest request, ShipmentStore store) =>
            store.Refund(id, request.AmountCents) is { } shipment ? Results.Ok(shipment) : Results.NotFound())
            .RequireAuthorization(Policies.Admin);

        return group;
    }
}
