# Testing minimal APIs on .NET 10

## Project

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <OutputType>Exe</OutputType>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.14" />
    <PackageReference Include="xunit.v3" Version="4.0.2" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/Ticketing.Api/Ticketing.Api.csproj" />
  </ItemGroup>
</Project>
```

`global.json` at the repo root:

```json
{
  "sdk": { "version": "10.0.403", "rollForward": "latestPatch" },
  "test": { "runner": "Microsoft.Testing.Platform" }
}
```

- xunit.v3 4.x defaults to Microsoft.Testing.Platform v2. The .NET 10 SDK's `dotnet test` refuses
  to drive it through VSTest: "Testing with VSTest target is no longer supported by
  Microsoft.Testing.Platform on .NET 10 SDK and later" (measured). The `test.runner` setting
  switches `dotnet test` to MTP mode; then `Microsoft.NET.Test.Sdk` and `xunit.runner.visualstudio`
  are optional.
- In MTP mode, pass the project explicitly: `dotnet test --project tests/Ticketing.Tests`. Filters
  are MTP options, e.g. `--filter-method "*Validation*"`.
- xunit v3 analyzers warn (xUnit1051) when a test doesn't pass
  `TestContext.Current.CancellationToken` to async calls.

## Factory

```csharp
public sealed class TicketingFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Production");          // test the production error behaviour
        builder.ConfigureTestServices(services => { /* fakes */ });
    }
}
```

- The top-level `Program` is public on .NET 10 (measured: a test project referenced it without
  `public partial class Program;`). Older target frameworks still need that line.
- One factory per test class (`IClassFixture<T>`) shares one app and its singletons; tests that
  mutate in-memory state must not depend on each other's data.
- `CreateClient(new() { AllowAutoRedirect = false })` shows 302s instead of following them to the
  login page, which otherwise hides a broken 401. Cookies are kept by default (`HandleCookies`).
- `factory.Services` gives the app's root provider: resolve `EndpointDataSource` to enumerate every
  mapped endpoint (and test them all for 401), or `IAuthorizationPolicyProvider` to inspect the
  fallback policy.

## What to assert

- Status code and `Content-Type` (`application/problem+json` for errors).
- For validation: the set of `errors` keys, compared case-insensitively unless the contract fixes
  the case, and that nothing was persisted.
- For auth: signed out, signed in without the role, and signed in with it, for each protected
  endpoint, plus one HTML page that must still redirect.
- For modules in class libraries: at least one invalid request per module endpoint, since a missing
  `AddValidation()` in that assembly fails silently.

## Offline and reproducible restores

- `RestorePackagesWithLockFile` + committed `packages.lock.json`, and `dotnet restore --locked-mode`
  in CI.
- A `nuget.config` with `<add key="globalPackagesFolder" value=".nuget/packages" />` keeps packages
  inside the repo, so a container can restore once with network and build and test later with
  `--network none` (measured: restore, build and the test run took about 6 s offline).
