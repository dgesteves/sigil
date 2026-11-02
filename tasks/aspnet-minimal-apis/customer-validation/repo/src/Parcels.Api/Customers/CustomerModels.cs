namespace Parcels.Api.Customers;

public record CreateCustomerRequest(
    string? Name,
    string? Email,
    string? Phone,
    Address? BillingAddress,
    List<ContactPerson>? Contacts);

public record Address(
    string? Line1,
    string? Line2,
    string? City,
    string? Postcode,
    string? CountryCode);

public record ContactPerson(string? Name, string? Email);

public record Customer(
    Guid Id,
    string Name,
    string Email,
    string? Phone,
    Address BillingAddress,
    IReadOnlyList<ContactPerson> Contacts,
    DateTimeOffset CreatedAt);

public record PagedList<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total);
