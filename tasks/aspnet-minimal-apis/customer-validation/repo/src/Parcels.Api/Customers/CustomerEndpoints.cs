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

    private static Ok<PagedList<Customer>> List(CustomerStore store, int page = 1, int pageSize = 20) =>
        TypedResults.Ok(store.List(page, pageSize));

    private static Results<Ok<Customer>, NotFound> Get(Guid id, CustomerStore store) =>
        store.Find(id) is { } customer ? TypedResults.Ok(customer) : TypedResults.NotFound();

    private static Results<Created<Customer>, BadRequest<string>> Create(
        CreateCustomerRequest request,
        CustomerStore store)
    {
        // TODO: real validation. These two checks were added after the first bad import.
        if (string.IsNullOrWhiteSpace(request.Name))
            return TypedResults.BadRequest("name is required");
        if (request.Email is null || !request.Email.Contains('@'))
            return TypedResults.BadRequest("email is invalid");

        var customer = store.Add(request);
        return TypedResults.Created($"/api/customers/{customer.Id}", customer);
    }
}
