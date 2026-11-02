# Sources

Checked in November 2026 against .NET 10.0.14 (ASP.NET Core 10.0.14, SDK 10.0.403), the current
LTS. .NET 11.0.0-rc.3 was the newest preview and is not covered.

## Versions

- .NET release metadata (10.0 = LTS, active, latest release 10.0.14, SDK 10.0.403; 11.0 = rc.3):
  https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/releases-index.json
- Container tags `mcr.microsoft.com/dotnet/sdk:10.0.403` (same digest as `10.0`):
  https://mcr.microsoft.com/v2/dotnet/sdk/tags/list
- NuGet: Microsoft.AspNetCore.Mvc.Testing 10.0.14, Microsoft.Extensions.Validation 10.0.14,
  Microsoft.AspNetCore.OpenApi 10.0.14, xunit.v3 4.0.2 (2026-10-09), xunit.runner.visualstudio
  4.0.1, Microsoft.NET.Test.Sdk 18.11.0: https://api.nuget.org/v3-flatcontainer/{id}/index.json

## Documentation

- What's new in ASP.NET Core 10 (validation, IProblemDetailsService for validation errors,
  exception-handler diagnostics, cookie 401/403, form empty strings, SSE, OpenAPI 3.1, PipeReader
  JSON): https://learn.microsoft.com/aspnet/core/release-notes/aspnetcore-10.0
- Validation in ASP.NET Core (registration, order, nested types, cross-assembly registration,
  missing-metadata behaviour, experimental attributes and ASP0029, the nullable value-type
  parameter limitation): https://learn.microsoft.com/aspnet/core/fundamentals/validation
- Minimal APIs quick reference (validation support, DisableValidation, TypedResults vs Results,
  route groups): https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis
- Breaking change: cookie login redirects disabled for known API endpoints
  (IDisableCookieRedirectMetadata, DisableCookieRedirect, AllowCookieRedirect,
  IgnoreRedirectMetadata switch, XHR behaviour):
  https://learn.microsoft.com/aspnet/core/breaking-changes/10/cookie-authentication-api-endpoints
- Known issue dotnet/aspnetcore#67033 (nullable value-type parameters not validated):
  https://github.com/dotnet/aspnetcore/issues/67033
- Handle errors in minimal APIs (AddProblemDetails, UseExceptionHandler, UseStatusCodePages,
  IExceptionHandler, StatusCodeSelector):
  https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/handle-errors
- Responses in minimal APIs (TypedResults, Results<T1,...>):
  https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/responses
- Fallback and default authorization policies:
  https://learn.microsoft.com/aspnet/core/security/authorization/secure-data#require-authenticated-users
- Antiforgery with minimal APIs:
  https://learn.microsoft.com/aspnet/core/security/anti-request-forgery#antiforgery-with-minimal-apis
- Validator.TryValidateObject (does not validate nested property values):
  https://learn.microsoft.com/dotnet/api/system.componentmodel.dataannotations.validator.tryvalidateobject
- Integration tests with WebApplicationFactory:
  https://learn.microsoft.com/aspnet/core/test/integration-tests
- xunit v3 on Microsoft.Testing.Platform, and `dotnet test` with `global.json` `test.runner` on the
  .NET 10 SDK: https://xunit.net/docs/getting-started/v3/microsoft-testing-platform and
  https://learn.microsoft.com/dotnet/core/testing/unit-testing-with-dotnet-test

## Behaviour reproduced by running it

All in `mcr.microsoft.com/dotnet/sdk:10.0.403` (runtime 10.0.14, linux-arm64), through
WebApplicationFactory and TestServer:

- Without `AddValidation()`, records with DataAnnotations on positional parameters, nested types,
  lists, `IValidatableObject` and attributed query parameters all reached the handler (201/200).
  With it, each produced a 400 `application/problem+json` with PascalCase member-path keys
  (`Lines[0].Sku`, `ShipTo.Zip`), the parameter name as the key for query parameters, `""` for
  an object-level `ValidationResult` without member names, and no `Validate` call while a
  property attribute failed.
- `[JsonPropertyName]` and `[Display(Name)]` did not change error keys; `CustomizeProblemDetails`
  ran for validation responses and the key-rewrite snippet in validation.md produced
  `venue.postalCode` and `tiers[1].priceCents`.
- `[Required] int` with the property missing from the JSON produced no error.
- Endpoint in a class library (`Microsoft.NET.Sdk` + `FrameworkReference Microsoft.AspNetCore.App`)
  with a record body: not validated with `AddValidation()` in the host only, validated with an
  additional call in the library, host endpoints unvalidated with the library call only, and still
  unvalidated with `[ValidatableType]` (ASP0029 suppressed) on the library record and the host-only
  call. Attributed `int`/`string` query parameters on library endpoints were validated with the
  host-only call.
- An endpoint filter using `Validator.TryValidateObject(..., validateAllProperties: true)` on records
  with attributes on positional parameters accepted every invalid request.
- Cookie authentication with `RequireAuthorization()`: 401 for `TypedResults.Ok`, `Results<...>`
  unions, POCO returns, JSON-body endpoints and `TypedResults.NoContent()`; 302 to the login path for
  `Results.Ok`, `Results.NoContent`, `string` and `TypedResults.Text`. `DisableCookieRedirect()` on
  the groups, or path-based `OnRedirectToLogin`/`OnRedirectToAccessDenied` events, made all of them
  401/403. Without `UseStatusCodePages()` the 401 had no body or content type.
- `UseExceptionHandler()` without `AddProblemDetails()` threw at startup with the quoted message.
  With both, unexpected exceptions were a generic 500 problem in Production and Development;
  without `UseExceptionHandler`, Development returned the exception message and stack trace.
  `StatusCodeSelector` set 409 without a detail; an `IExceptionHandler` wrote a 409 problem with
  its own detail.
- `[FromForm]` endpoints returned 500 ("contains anti-forgery metadata, but a middleware was not
  found") without `UseAntiforgery()`, also when only `AddAntiforgery()` was called, and 400 for a
  missing token with it.
- xunit.v3 4.0.2 under the .NET 10 SDK `dotnet test` without `global.json` `test.runner`: "Testing
  with VSTest target is no longer supported by Microsoft.Testing.Platform on .NET 10 SDK and later".
  With it: passed.
- A test project used `WebApplicationFactory<Program>` against a web project without
  `public partial class Program;`.
