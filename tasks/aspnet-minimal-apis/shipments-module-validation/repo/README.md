# parcels-api

Customer and shipment API for the parcels platform. ASP.NET Core minimal APIs on .NET 10.

## Commands

```sh
dotnet build Parcels.slnx
dotnet test --project tests/Parcels.Tests   # xunit v3 on Microsoft.Testing.Platform (see global.json)
dotnet run --project src/Parcels.Api
```

Packages restore into `.nuget/packages` inside the repo (see `nuget.config`), and every project has
a `packages.lock.json`. New NuGet packages need a security review first, so please don't add any
without asking.

## Layout

- `src/Parcels.Api`: the host. `Program.cs` registers services and maps every module's endpoints.
  The customers endpoints (`/api/customers`) live here.
- `src/Parcels.Shipments`: the shipments module (`/api/shipments`), a class library that owns its
  endpoints, request records and services. The host only calls `AddShipmentsModule()` and
  `MapShipmentsModule()`. More modules (returns, invoicing) will follow the same shape.
- `tests/Parcels.Tests`: integration tests through `WebApplicationFactory`.

## Validation and errors

Request validation uses the built-in minimal API validation of .NET 10 (`AddValidation()` in
`Program.cs`): DataAnnotations attributes on handler parameters and on the records they bind. A
request that fails validation gets a 400 `application/problem+json` response whose `errors` map
lists every invalid field path (for example `Email`). Other errors are problem details too
(`AddProblemDetails`, `UseExceptionHandler`, `UseStatusCodePages`).
