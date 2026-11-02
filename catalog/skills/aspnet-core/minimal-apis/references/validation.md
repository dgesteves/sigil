# Minimal API validation on .NET 10

Measured on .NET 10.0.14 (SDK 10.0.403) unless marked as documented.

## Setup

```csharp
builder.Services.AddValidation();   // Microsoft.Extensions.Validation, part of the ASP.NET Core 10 shared framework
```

- One call per assembly that maps endpoints or declares request types (see below).
- No package is needed in a `Microsoft.NET.Sdk.Web` project or in a class library with
  `<FrameworkReference Include="Microsoft.AspNetCore.App" />` (measured). A library without the
  framework reference needs the `Microsoft.Extensions.Validation` package (documented).
- `.DisableValidation()` opts one endpoint out.
- The top-level `AddValidation` API and the validation endpoint filter are stable. The resolver
  APIs and the `[ValidatableType]` / `[SkipValidation]` attributes are experimental in .NET 10
  (`ASP0029` unless suppressed); they stop being experimental in .NET 11 (documented).

## What gets validated

| Input | Validated | Notes |
| --- | --- | --- |
| Body record/class (`CreateEventRequest request`) | yes | Attributes on positional record parameters and on properties both work. |
| Nested object (`Venue? Venue`) | yes | Key `Venue.Capacity`. |
| Collection items (`List<TicketTier>`) | yes | Key `Tiers[1].PriceCents`; null items are skipped. |
| Query/header parameter with attributes (`[Range(1, 50)] int limit = 10`) | yes | Key is the parameter name, `limit`. |
| `[AsParameters]` record | yes | Keys are the property names (`Limit`). |
| Nullable value-type parameter that is null (`[Range(1,9)] int? n`) | **no** | Known .NET 10 limitation, dotnet/aspnetcore#67033 (documented). |
| Unknown JSON properties | **no** | Use `UnmappedMemberHandling.Disallow` on the JSON options if you must reject them. |
| Types and endpoints in an assembly that never calls `AddValidation()` | **no** | Silent. See below. |

Order inside one object (measured and documented):

1. Attributes on each property, then the property's value (recursing). Any error here **skips** 2 and 3.
2. Type-level attributes.
3. `IValidatableObject.Validate`.

So a request with a missing field *and* an inverted date range reports only the missing field.
Don't write tests that expect both at once from the built-in pipeline. `ValidationResult` member
names become the last key segment (`Sales.Closes`); a result with no member name on the root
object is reported under the key `""`.

## The response

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1",
 "title":"One or more validation errors occurred.","status":400,
 "errors":{"Title":["The Title field is required."],"Tiers[1].PriceCents":["The field PriceCents must be between 0 and 1000000."]},
 "traceId":"00-..."}
```

- Keys are **PascalCase C# member paths**, even though the body is camelCase JSON.
  `[JsonPropertyName("event_title")]` does not change the key; `[Display(Name = ...)]` changes the
  message only.
- Malformed JSON or a `null` body is a 400 problem *without* an `errors` map ("Bad Request").
- `AddProblemDetails(o => o.CustomizeProblemDetails = ...)` runs for validation responses, so it can
  rename keys. Measured to produce `venue.postalCode` and `tiers[1].priceCents`:

```csharp
builder.Services.AddProblemDetails(options => options.CustomizeProblemDetails = context =>
{
    if (context.ProblemDetails is not HttpValidationProblemDetails validation) return;
    var renamed = validation.Errors.ToDictionary(
        e => string.Join('.', e.Key.Split('.').Select(s => JsonNamingPolicy.CamelCase.ConvertName(s))),
        e => e.Value);
    validation.Errors.Clear();
    foreach (var (key, messages) in renamed) validation.Errors[key] = messages;
});
```

Only do this when the contract asks for JSON names; otherwise document PascalCase keys and let
clients compare case-insensitively.

## Modular apps: one `AddValidation()` per assembly

The validation source generator emits metadata for the compilation that contains the
`AddValidation()` call. Results on 10.0.14, endpoint `POST /venues` mapped from a class library:

| `AddValidation()` called in | Host endpoints validated | Library endpoints (record body) validated |
| --- | --- | --- |
| host only | yes | **no**, 200 with the invalid body |
| host and library | yes | yes |
| library only | **no** | yes |
| host only, `[ValidatableType]` on the library record | yes | **no** |

Attributes on *simple* parameters of library endpoints (`[Range] int seats` in the query) were
validated with the host-only call; only complex types needed library metadata. The fix is an
`AddValidation()` inside the library's own registration method, which keeps the module
self-contained:

```csharp
public static IServiceCollection AddVenuesModule(this IServiceCollection services)
{
    services.AddValidation();
    // module services...
    return services;
}
```

Call both `builder.Services.AddValidation()` and `builder.Services.AddVenuesModule()` from the host.

## Attribute notes

| Attribute | Behaviour worth knowing |
| --- | --- |
| `[Required]` | Fails null, `""` and whitespace strings. On a non-nullable value type it never fails (missing JSON number = 0). |
| `[Range(a, b)]` | Inclusive. Use it, not `[Required]`, for "must be present and positive" ints. |
| `[MaxLength]`, `[MinLength]`, `[Length(min,max)]` | Work on strings and collections. `[Length]` since .NET 8. |
| `[StringLength(max)]` | Strings only. |
| `[AllowedValues(...)]`, `[DeniedValues(...)]` | .NET 8+. Compares with `Equals`, so strings are case-sensitive. |
| `[RegularExpression]` | Must match the whole value. Null and `""` pass; pair with `[Required]`. |
| `[EmailAddress]` | One `@`, not first or last. Not RFC validation. |
| `[Phone]`, `[Url]` | Loose. `[Url]` accepts any `http`, `https` or `ftp` prefix. |

## Not substitutes

- **`Validator.TryValidateObject(obj, ctx, results, validateAllProperties: true)`** reads attributes
  from properties only. Attributes written on positional record parameters target the parameter,
  so it sees none of them (measured: an endpoint filter built on it accepted every invalid
  request), and it does not recurse into nested objects or collections (documented).
- **Attributes without `AddValidation()`**: minimal APIs never had MVC's automatic `ModelState`
  validation. On .NET 8 and 9, and on .NET 10 without the call, the attributes are ignored.

## .NET 8 and 9

No built-in validation. Either validate in the handler and return
`TypedResults.ValidationProblem(errors)` (a `Dictionary<string, string[]>`, same response shape),
or write an endpoint filter that walks the object graph itself. Use the same key format the
clients expect, and include nested and indexed paths. Upgrading to .NET 10 later means deleting
that code and adding `AddValidation()`, so keep the rules declarative where you can.
