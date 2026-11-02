using System.Collections.Concurrent;

namespace Parcels.Api.Customers;

public sealed class CustomerStore(TimeProvider clock)
{
    private readonly ConcurrentDictionary<Guid, Customer> _customers = new();

    public Customer Add(CreateCustomerRequest request)
    {
        var customer = new Customer(
            Guid.NewGuid(),
            request.Name!.Trim(),
            request.Email!.Trim(),
            request.Phone,
            request.BillingAddress!,
            request.Contacts ?? [],
            clock.GetUtcNow());
        _customers[customer.Id] = customer;
        return customer;
    }

    public Customer? Find(Guid id) => _customers.GetValueOrDefault(id);

    public PagedList<Customer> List(int page, int pageSize)
    {
        var ordered = _customers.Values.OrderBy(c => c.CreatedAt).ThenBy(c => c.Id).ToList();
        var items = ordered.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        return new PagedList<Customer>(items, page, pageSize, ordered.Count);
    }
}
