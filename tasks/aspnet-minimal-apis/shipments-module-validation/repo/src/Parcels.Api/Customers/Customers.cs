using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Parcels.Api.Customers;

public record CreateCustomerRequest(
    [Required, MaxLength(100)] string? Name,
    [Required, EmailAddress] string? Email,
    [Phone] string? Phone);

public record Customer(Guid Id, string Name, string Email, string? Phone);

public sealed class CustomerStore
{
    private readonly ConcurrentDictionary<Guid, Customer> _customers = new();

    public Customer Add(CreateCustomerRequest request)
    {
        var customer = new Customer(Guid.NewGuid(), request.Name!, request.Email!, request.Phone);
        _customers[customer.Id] = customer;
        return customer;
    }

    public Customer? Find(Guid id) => _customers.GetValueOrDefault(id);
}

public static class CustomerEndpoints
{
    public static RouteGroupBuilder MapCustomers(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/customers").WithTags("Customers");

        group.MapPost("/", (CreateCustomerRequest request, CustomerStore store) =>
        {
            var customer = store.Add(request);
            return TypedResults.Created($"/api/customers/{customer.Id}", customer);
        });

        group.MapGet("/{id:guid}", Results<Ok<Customer>, NotFound> (Guid id, CustomerStore store) =>
            store.Find(id) is { } customer ? TypedResults.Ok(customer) : TypedResults.NotFound());

        return group;
    }
}
