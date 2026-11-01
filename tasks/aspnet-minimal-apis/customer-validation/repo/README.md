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

- `src/Parcels.Api/Program.cs`: host setup and endpoint registration.
- `src/Parcels.Api/Customers/`: the customers endpoints (`/api/customers`), request/response
  records and an in-memory store.
- `tests/Parcels.Tests/`: integration tests through `WebApplicationFactory`.

Errors are RFC 9457 problem details (`AddProblemDetails`, `UseExceptionHandler`,
`UseStatusCodePages`). The frontend reads `application/problem+json` bodies, including the `errors`
map of validation problems.
