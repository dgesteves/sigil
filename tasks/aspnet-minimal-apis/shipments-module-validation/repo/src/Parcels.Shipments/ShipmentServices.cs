using System.Collections.Concurrent;

namespace Parcels.Shipments;

public sealed class Pricing
{
    private static readonly Dictionary<string, (long BaseCents, long PerKgCents)> Tariffs = new()
    {
        ["standard"] = (450, 90),
        ["express"] = (890, 150),
        ["same-day"] = (1590, 210),
    };

    public long PriceCents(string service, int weightGrams)
    {
        var (baseCents, perKg) = Tariffs[service];
        return baseCents + perKg * (long)Math.Ceiling(weightGrams / 1000.0);
    }
}

public sealed class ShipmentBook(Pricing pricing)
{
    private readonly ConcurrentDictionary<string, Shipment> _shipments = new();
    private int _sequence = 5000;

    public Shipment Book(BookShipmentRequest request)
    {
        var id = $"SHP-{Interlocked.Increment(ref _sequence)}";
        var parcels = request.Parcels!;
        var price = parcels.Sum(p => pricing.PriceCents(request.Service!, p.WeightGrams));
        var shipment = new Shipment(
            id, request.CustomerId!.Value, request.Service!, request.Pickup!, request.Delivery!,
            parcels, request.PickupWindow, request.Reference, price);
        _shipments[id] = shipment;
        return shipment;
    }

    public Shipment? Find(string id) => _shipments.GetValueOrDefault(id);

    public IReadOnlyList<Shipment> All() => _shipments.Values.OrderBy(s => s.Id).ToList();
}
