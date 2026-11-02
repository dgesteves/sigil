using System.ComponentModel.DataAnnotations;

namespace Parcels.Api.Customers;

public record CreateCustomerRequest(
    [Required, MaxLength(100)] string? Name,
    [Required, EmailAddress] string? Email,
    string? Phone,
    [Required] Address? BillingAddress,
    [MaxLength(5)] List<ContactPerson>? Contacts);

public record Address(
    [Required] string? Line1,
    string? Line2,
    [Required] string? City,
    [Required, MaxLength(10)] string? Postcode,
    [Required, RegularExpression("^[A-Z]{2}$", ErrorMessage = "Use a two-letter ISO 3166-1 country code, such as PT.")]
    string? CountryCode);

public record ContactPerson([Required] string? Name, [Required, EmailAddress] string? Email);

public record Customer(
    Guid Id,
    string Name,
    string Email,
    string? Phone,
    Address BillingAddress,
    IReadOnlyList<ContactPerson> Contacts,
    DateTimeOffset CreatedAt);

public record PagedList<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total);
