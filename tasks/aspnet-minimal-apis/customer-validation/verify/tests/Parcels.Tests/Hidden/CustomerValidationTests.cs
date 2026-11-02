using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Parcels.Api.Customers;

namespace Parcels.Tests.Hidden;

public class CustomerValidationTests(ParcelsApiFactory factory) : IClassFixture<ParcelsApiFactory>
{
    private static JsonObject Valid() => new()
    {
        ["name"] = "Marta Sousa",
        ["email"] = "marta.sousa@example.com",
        ["phone"] = "+351 220 000 000",
        ["billingAddress"] = new JsonObject
        {
            ["line1"] = "Avenida dos Aliados 10",
            ["line2"] = "3 Esq",
            ["city"] = "Porto",
            ["postcode"] = "4000-064",
            ["countryCode"] = "PT",
        },
        ["contacts"] = new JsonArray(
            new JsonObject { ["name"] = "Joana Lima", ["email"] = "joana.lima@example.com" },
            new JsonObject { ["name"] = "Pedro Alves", ["email"] = "pedro.alves@example.com" }),
    };

    private async Task<HttpResponseMessage> Post(JsonNode body) =>
        await factory.CreateClient().PostAsJsonAsync(
            "/api/customers", body, TestContext.Current.CancellationToken);

    private async Task<int> CountCustomers()
    {
        var page = await factory.CreateClient().GetFromJsonAsync<PagedList<Customer>>(
            "/api/customers?page=1&pageSize=100", TestContext.Current.CancellationToken);
        return page!.Total;
    }

    [Fact]
    public async Task A_valid_customer_is_created()
    {
        var response = await Post(Valid());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task A_customer_without_optional_fields_is_created()
    {
        var body = Valid();
        body.Remove("phone");
        body.Remove("contacts");
        body["billingAddress"]!.AsObject().Remove("line2");
        var response = await Post(body);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task An_empty_body_reports_every_required_field()
    {
        var problem = await ValidationProblem.ReadAsync(await Post(new JsonObject()));
        problem.Has("name", "email", "billingAddress");
    }

    [Fact]
    public async Task Name_and_email_rules()
    {
        var body = Valid();
        body["name"] = new string('x', 101);
        body["email"] = "not-an-email";
        var problem = await ValidationProblem.ReadAsync(await Post(body));
        problem.Has("name", "email");
        problem.Lacks("billingAddress", "contacts");

        var exactly100 = Valid();
        exactly100["name"] = new string('y', 100);
        Assert.Equal(HttpStatusCode.Created, (await Post(exactly100)).StatusCode);

        var blank = Valid();
        blank["email"] = "";
        (await ValidationProblem.ReadAsync(await Post(blank))).Has("email");
    }

    [Fact]
    public async Task Billing_address_fields_are_validated_by_path()
    {
        var body = Valid();
        body["billingAddress"] = new JsonObject
        {
            ["line2"] = "only the second line",
            ["postcode"] = "12345678901",
            ["countryCode"] = "Portugal",
        };
        var problem = await ValidationProblem.ReadAsync(await Post(body));
        problem.Has(
            "billingAddress.line1",
            "billingAddress.city",
            "billingAddress.postcode",
            "billingAddress.countryCode");
        problem.Lacks("name", "email", "billingAddress.line2");
    }

    [Theory]
    [InlineData("pt")]
    [InlineData("P1")]
    [InlineData("PRT")]
    public async Task Country_code_must_be_two_uppercase_letters(string code)
    {
        var body = Valid();
        body["billingAddress"]!["countryCode"] = code;
        (await ValidationProblem.ReadAsync(await Post(body))).Has("billingAddress.countryCode");
    }

    [Fact]
    public async Task Each_contact_is_validated_by_index()
    {
        var body = Valid();
        body["contacts"] = new JsonArray(
            new JsonObject { ["name"] = "Fine Person", ["email"] = "fine@example.com" },
            new JsonObject { ["name"] = "Broken Email", ["email"] = "broken.example.com" },
            new JsonObject { ["email"] = "nameless@example.com" });
        var problem = await ValidationProblem.ReadAsync(await Post(body));
        problem.Has("contacts[1].email", "contacts[2].name");
        problem.Lacks("contacts[0].name", "contacts[0].email", "contacts[1].name", "contacts[2].email");
    }

    [Fact]
    public async Task At_most_five_contacts()
    {
        var body = Valid();
        var contacts = new JsonArray();
        for (var i = 0; i < 6; i++)
            contacts.Add(new JsonObject { ["name"] = $"Contact {i}", ["email"] = $"c{i}@example.com" });
        body["contacts"] = contacts;
        (await ValidationProblem.ReadAsync(await Post(body))).Has("contacts");

        contacts.RemoveAt(5);
        Assert.Equal(HttpStatusCode.Created, (await Post(body)).StatusCode);
    }

    [Fact]
    public async Task All_problems_are_reported_in_one_response_and_nothing_is_stored()
    {
        var before = await CountCustomers();
        var body = new JsonObject
        {
            ["name"] = "",
            ["email"] = "jane.doe@",
            ["billingAddress"] = new JsonObject { ["line1"] = "Rua Nova 1", ["city"] = "Braga", ["postcode"] = "4700-000" },
            ["contacts"] = new JsonArray(new JsonObject { ["name"] = "Ok Name", ["email"] = "nope" }),
        };
        var problem = await ValidationProblem.ReadAsync(await Post(body));
        problem.Has("name", "email", "billingAddress.countryCode", "contacts[0].email");
        Assert.Equal(before, await CountCustomers());
    }

    [Theory]
    [InlineData("/api/customers?page=0", "page")]
    [InlineData("/api/customers?page=-3&pageSize=10", "page")]
    [InlineData("/api/customers?pageSize=0", "pageSize")]
    [InlineData("/api/customers?pageSize=101", "pageSize")]
    public async Task Paging_parameters_are_validated(string url, string field)
    {
        var response = await factory.CreateClient().GetAsync(url, TestContext.Current.CancellationToken);
        (await ValidationProblem.ReadAsync(response)).Has(field);
    }

    [Theory]
    [InlineData("/api/customers")]
    [InlineData("/api/customers?page=2&pageSize=100")]
    [InlineData("/api/customers?pageSize=1")]
    public async Task Valid_paging_still_works(string url)
    {
        var response = await factory.CreateClient().GetAsync(url, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
