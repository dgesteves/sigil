# Problem details, exceptions and typed results

## Pipeline

```csharp
builder.Services.AddProblemDetails();                       // IProblemDetailsService
builder.Services.AddExceptionHandler<DomainExceptionHandler>();

var app = builder.Build();
app.UseExceptionHandler();      // first, so it wraps everything
app.UseStatusCodePages();       // before auth, so 401/403 from auth get bodies too
app.UseAuthentication();
app.UseAuthorization();
```

Measured on 10.0.14 with a handler that throws `InvalidOperationException("db password=...")`:

| Setup | Production | Development |
| --- | --- | --- |
| `AddProblemDetails` + `UseExceptionHandler()` | 500 problem, generic title, no detail | same |
| `AddProblemDetails`, no `UseExceptionHandler` | no problem body (the exception escapes the pipeline; TestServer rethrows it into the test) | 500 problem **with exception type, message and stack trace** |
| `UseExceptionHandler()` without `AddProblemDetails` | startup fails: "Either the 'ExceptionHandlingPath' or the 'ExceptionHandler' property must be set..." | same |

Every problem body written by `IProblemDetailsService` gets a `traceId` extension.

## Mapping expected exceptions

Prefer returning results (`TypedResults.Conflict(...)`, `TypedResults.Problem(...)`) over throwing for
expected outcomes. When domain code throws, map it once:

```csharp
sealed class DomainExceptionHandler(IProblemDetailsService problems) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception ex, CancellationToken ct)
    {
        if (ex is not SeatAlreadySoldException sold) return false;   // let the default 500 happen
        http.Response.StatusCode = StatusCodes.Status409Conflict;
        return await problems.TryWriteAsync(new()
        {
            HttpContext = http,
            Exception = ex,
            ProblemDetails = { Title = "Seat already sold", Detail = $"Seat {sold.Seat} is taken." },
        });
    }
}
```

- Handlers run in registration order; the first one returning `true` wins.
- `ExceptionHandlerOptions.StatusCodeSelector` (.NET 9+) picks a status per exception type but
  keeps the generic title and no detail (measured).
- .NET 10: exceptions handled by an `IExceptionHandler` are no longer logged by the middleware. Set
  `SuppressDiagnosticsCallback` on `ExceptionHandlerOptions` to change that.
- `detail` is client-visible. Only messages written for clients go there; never `ex.ToString()`.

## Status code pages

`UseStatusCodePages()` with `AddProblemDetails()` writes a problem body for any 400-599 response
that has no body yet: 404 for unknown routes, 401/403 from authentication, `TypedResults.NotFound()`.
Without it those responses have no `Content-Type` (measured for 401).

## Typed results

| Want | Write | Type |
| --- | --- | --- |
| 200 with JSON | `TypedResults.Ok(dto)` | `Ok<T>` |
| 201 | `TypedResults.Created($"/api/events/{id}", dto)` | `Created<T>` |
| 204 | `TypedResults.NoContent()` | `NoContent` |
| 404 | `TypedResults.NotFound()` | `NotFound` |
| 400 field errors | `TypedResults.ValidationProblem(dict)` | `ValidationProblem` |
| other problem | `TypedResults.Problem(title:, statusCode:)` | `ProblemHttpResult` |
| several | `Results<Ok<T>, NotFound, ValidationProblem>` as the return type | union |

- Unions require every branch to return one of the listed types. Lambdas need the explicit return
  type: `group.MapGet("/{id}", Results<Ok<Ticket>, NotFound> (int id, TicketStore s) => ...)`.
- `Results.*` returns `IResult`: no OpenAPI response metadata, and on .NET 10 no API marker for
  cookie authentication (see auth.md).
- `TypedResults.Text`/`Content` are for non-JSON payloads (CSV, HTML); they are not treated as API
  endpoints either.
- Unit-test handlers by calling them and asserting the result type (`Assert.IsType<Ok<Ticket>>`),
  or integration-test through HTTP.

## Other .NET 10 changes that bite

- JSON bodies are read through a `PipeReader`; a custom `JsonConverter` that ignores
  `Utf8JsonReader.HasValueSequence` can lose data. Temporary switch:
  `Microsoft.AspNetCore.UseStreamBasedJsonParsing`.
- OpenAPI documents default to 3.1, and with `NumberHandling.AllowReadingFromString` (the web
  default) `int`/`long` schemas are no longer `type: integer`.
- `[FromForm]` complex objects bind empty strings to `null` instead of failing.
- `TypedResults.ServerSentEvents(IAsyncEnumerable<SseItem<T>>)` streams SSE.
