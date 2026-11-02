using System.ComponentModel.DataAnnotations;

namespace Parcels.Shipments;

public record BookShipmentRequest(
    [Required] Guid? CustomerId,
    [Required, AllowedValues("standard", "express", "same-day")] string? Service,
    [Required] ShipmentAddress? Pickup,
    [Required] ShipmentAddress? Delivery,
    [Required, Length(1, 20)] List<ParcelItem>? Parcels,
    PickupWindow? PickupWindow,
    [MaxLength(35)] string? Reference);

public record ShipmentAddress(
    [MaxLength(100)] string? Name,
    [Required] string? Line1,
    string? Line2,
    [Required] string? City,
    [Required, MaxLength(10)] string? Postcode,
    [Required, RegularExpression("^[A-Z]{2}$", ErrorMessage = "Use a two-letter ISO 3166-1 country code, such as PT.")]
    string? CountryCode);

public record ParcelItem(
    [Range(1, 30000)] int WeightGrams,
    [Range(1, 150)] int LengthCm,
    [Range(1, 150)] int WidthCm,
    [Range(1, 150)] int HeightCm);

public record PickupWindow([Required] DateTimeOffset? From, [Required] DateTimeOffset? To) : IValidatableObject
{
    // Runs only after the attributes above pass, so From and To are both set here.
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (To <= From)
            yield return new ValidationResult("The pickup window must end after it starts.", [nameof(To)]);
    }
}

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
