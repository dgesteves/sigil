using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Parcels.Api.Customers;

public static class CustomerEndpoints
{
    public static RouteGroupBuilder MapCustomers(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/customers").WithTags("Customers");

        group.MapGet("/", List);
        group.MapGet("/{id:guid}", Get);
        group.MapPost("/", Create);

        return group;
    }

    private static Ok<PagedList<Customer>> List(
        CustomerStore store,
        [Range(1, int.MaxValue)] int page = 1,
        [Range(1, 100)] int pageSize = 20) =>
        TypedResults.Ok(store.List(page, pageSize));

    private static Results<Ok<Customer>, NotFound> Get(Guid id, CustomerStore store) =>
        store.Find(id) is { } customer ? TypedResults.Ok(customer) : TypedResults.NotFound();

    // The validation filter rejects invalid requests with a 400 before this runs.
    private static Created<Customer> Create(CreateCustomerRequest request, CustomerStore store)
    {
        var customer = store.Add(request);
        return TypedResults.Created($"/api/customers/{customer.Id}", customer);
    }
}
