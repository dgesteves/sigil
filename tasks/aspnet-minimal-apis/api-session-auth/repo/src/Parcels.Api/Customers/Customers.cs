using System.Collections.Concurrent;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Parcels.Api.Customers;

public record CreateCustomerRequest(string Name, string Email);

public record Customer(Guid Id, string Name, string Email, DateTimeOffset CreatedAt);

public sealed class CustomerStore
{
    public static readonly Guid SeedCustomerA = Guid.Parse("6f1c2a3e-1b7d-4c55-9a0e-2d4b8f9a1c01");
    public static readonly Guid SeedCustomerB = Guid.Parse("6f1c2a3e-1b7d-4c55-9a0e-2d4b8f9a1c02");

    private readonly ConcurrentDictionary<Guid, Customer> _customers = new();
    private readonly TimeProvider _clock;

    public CustomerStore(TimeProvider clock)
    {
        _clock = clock;
        _customers[SeedCustomerA] = new(SeedCustomerA, "Livraria Lello", "orders@lello.example", clock.GetUtcNow());
        _customers[SeedCustomerB] = new(SeedCustomerB, "Conserveira de Lisboa", "shop@conserveira.example", clock.GetUtcNow());
    }

    public IReadOnlyList<Customer> All() => _customers.Values.OrderBy(c => c.Name).ToList();
    public Customer? Find(Guid id) => _customers.GetValueOrDefault(id);
    public bool Remove(Guid id) => _customers.TryRemove(id, out _);

    public Customer Add(CreateCustomerRequest request)
    {
        var customer = new Customer(Guid.NewGuid(), request.Name, request.Email, _clock.GetUtcNow());
        _customers[customer.Id] = customer;
        return customer;
    }
}

public static class CustomerEndpoints
{
    public static RouteGroupBuilder MapCustomers(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/customers").RequireAuthorization();

        group.MapGet("/", (CustomerStore store) => TypedResults.Ok(store.All()));

        group.MapGet("/{id:guid}", Results<Ok<Customer>, NotFound> (Guid id, CustomerStore store) =>
            store.Find(id) is { } customer ? TypedResults.Ok(customer) : TypedResults.NotFound());

        group.MapPost("/", (CreateCustomerRequest request, CustomerStore store) =>
        {
            var customer = store.Add(request);
            return TypedResults.Created($"/api/customers/{customer.Id}", customer);
        });

        // GDPR erasure. Back office only.
        group.MapDelete("/{id:guid}", (Guid id, CustomerStore store) =>
            store.Remove(id) ? Results.NoContent() : Results.NotFound());

        return group;
    }
}
