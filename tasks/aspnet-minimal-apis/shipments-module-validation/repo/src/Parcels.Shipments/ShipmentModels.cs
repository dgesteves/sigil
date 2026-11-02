namespace Parcels.Shipments;

public record BookShipmentRequest(
    Guid? CustomerId,
    string? Service,
    ShipmentAddress? Pickup,
    ShipmentAddress? Delivery,
    List<ParcelItem>? Parcels,
    PickupWindow? PickupWindow,
    string? Reference);

public record ShipmentAddress(
    string? Name,
    string? Line1,
    string? Line2,
    string? City,
    string? Postcode,
    string? CountryCode);

public record ParcelItem(int WeightGrams, int LengthCm, int WidthCm, int HeightCm);

public record PickupWindow(DateTimeOffset? From, DateTimeOffset? To);

public record Shipment(
    string Id,
    Guid CustomerId,
    string Service,
    ShipmentAddress Pickup,
    ShipmentAddress Delivery,
    IReadOnlyList<ParcelItem> Parcels,
    PickupWindow? PickupWindow,
    string? Reference,
    long PriceCents);

public record Quote(string Service, int WeightGrams, long PriceCents);
