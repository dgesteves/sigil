# HTTP clients, API versioning, resilience and virtual threads

Checked against Spring Boot 4.1.2 and Spring Framework 7.0.10. Claims marked "measured" were run
on 4.1.2; the rest come from the property metadata in the 4.1.2 jars, `javap` on the 4.1.2 classes,
or the documentation listed in sources.md.

## RestClient and RestTemplate

- `spring-boot-starter-restclient` auto-configures a prototype `RestClient.Builder` and a
  `RestTemplateBuilder`, both wired to Boot's message converters (Jackson 3) and client settings.
- `RestTemplateBuilder` is now `org.springframework.boot.restclient.RestTemplateBuilder`. The
  `set...` methods are gone (measured with `javap`): use `connectTimeout(Duration)`,
  `readTimeout(Duration)`, `rootUri(String)`, `baseUri(String)`, `clientSettings(...)`,
  `requestFactoryBuilder(...)`.
- Global settings for every auto-configured client: `spring.http.clients.connect-timeout`,
  `spring.http.clients.read-timeout`, `spring.http.clients.redirects`,
  `spring.http.clients.ssl.bundle`, `spring.http.clients.imperative.factory`. The 3.x names
  (`spring.http.client.*`) are deprecated aliases.
- `RestTemplate` still works; new code should use `RestClient`:

```java
@Component
class RoutingClient {
  private final RestClient rest;

  RoutingClient(RestClient.Builder builder, RoutingProperties props) {
    this.rest = builder.baseUrl(props.baseUrl().toString()).build();
  }

  Optional<Route> route(String id) {
    try {
      return Optional.ofNullable(rest.get().uri("/routes/{id}", id).retrieve().body(Route.class));
    } catch (HttpClientErrorException.NotFound e) {
      return Optional.empty();
    }
  }
}
```

`retrieve()` throws `HttpClientErrorException` subclasses for 4xx (measured: `NotFound` for a 404)
and `HttpServerErrorException` for 5xx; a read timeout surfaces as `ResourceAccessException`
(measured with a 300 ms read timeout against a 1.5 s response). Catch the ones you translate, or use
`.onStatus(predicate, handler)` to map them in one place.

## HTTP service clients (declarative interfaces)

```java
@HttpExchange("/routes")
interface RoutingApi {
  @GetExchange("/{id}")
  Route get(@PathVariable String id);
}

@Configuration
@ImportHttpServices(group = "routing", types = RoutingApi.class)
class RoutingClients {}
```

```properties
spring.http.serviceclient.routing.base-url=https://routing.internal.example
spring.http.serviceclient.routing.read-timeout=2s
spring.http.serviceclient.routing.connect-timeout=1s
```

Measured: the `RoutingApi` proxy is injectable and calls `<base-url>/routes/{id}`. `@ImportHttpServices`
also takes `basePackages`/`basePackageClasses` and `clientType` (`REST_CLIENT` by default). Group
settings accept the same keys as `spring.http.clients.*` plus `base-url`, `default-header` and API
version insertion (`apiversion.*`) (from `javap` on `HttpClientProperties`). Customize a group in
code with a `org.springframework.web.client.support.RestClientHttpServiceGroupConfigurer` bean.

Building proxies by hand (`HttpServiceProxyFactory.builderFor(RestClientAdapter.create(restClient))`)
still works and is fine for one interface.

## API versioning (Spring Framework 7)

```properties
spring.mvc.apiversion.use.header=API-Version
spring.mvc.apiversion.default=1.0
spring.mvc.apiversion.supported=1.0,2.0
```

```java
@GetMapping(path = "/journeys/{id}", version = "1.0") JourneyV1 v1(@PathVariable String id) { ... }
@GetMapping(path = "/journeys/{id}", version = "2.0") JourneyV2 v2(@PathVariable String id) { ... }
```

Measured with only `use.header` set (no default):

| Request | Result |
| --- | --- |
| `/journeys/1` without header | 400, `MissingApiVersionException` |
| `/health-check` (not versioned) without header | **400**, `MissingApiVersionException` |
| `API-Version: 1` | v1 handler |
| `API-Version: 2.0` or `2` | v2 handler |
| `API-Version: 3` | 400, `InvalidApiVersionException` |

So once versioning is on, every request needs a version unless you set
`spring.mvc.apiversion.default` (requests without one get it) or `spring.mvc.apiversion.required=false`.
Other resolvers: `use.query-parameter`, `use.path-segment` (index), `use.media-type-parameter`.
`detect-supported` (default on) adds versions declared in mappings to the supported set. A
`ApiVersionDeprecationHandler` bean (`StandardApiVersionDeprecationHandler`) can add `Deprecation`,
`Sunset` and `Link` headers for old versions. Clients: `ApiVersionInserter` on `RestClient`, or the
`apiversion` group properties above.

## Retries and concurrency limits in core Spring

Framework 7 moved the useful part of Spring Retry into `spring-context` and `spring-core`. Spring
Boot 4 does not manage a `spring-retry` version (absent from the 4.1.2 BOM).

```java
@Configuration
@EnableResilientMethods
class ResilienceConfig {}

@Service
class SeatMapService {
  @Retryable(includes = ResourceAccessException.class, maxRetries = 3, delay = 100, multiplier = 2, maxDelay = 1000)
  @ConcurrencyLimit(10)
  public SeatMap load(String trainId) { ... }
}
```

- `org.springframework.resilience.annotation.Retryable` defaults (from the class file):
  `maxRetries = 3`, `delay = 1000` ms, `jitter = 0`, `multiplier = 1.0` (no growth), time unit ms.
  `includes`/`excludes`/`predicate` choose which exceptions retry; with none given, any exception
  does (measured: an `UnsupportedOperationException` was retried).
- Measured: `maxRetries = 3` → up to **4** invocations; when all fail, the **last exception itself**
  is rethrown (not wrapped).
- `@ConcurrencyLimit(n)` bounds concurrent invocations of the method; `policy = BLOCK` (wait) or
  `REJECT` (throw `org.springframework.resilience.InvocationRejectedException`), per the javadoc.
  Not measured here.
- Both are proxy-based like `@Transactional`: calls from inside the same bean are not intercepted,
  and the method must be on a Spring bean and not private.
- Programmatic: `new RetryTemplate(RetryPolicy.builder().maxRetries(3).delay(Duration.ofMillis(100)).multiplier(2).includes(ResourceAccessException.class).build())`;
  measured with `maxRetries(2)`: 3 calls, then `execute(() -> ...)` throws `RetryException`
  (checked; `getCause()` is the last failure, `getRetryCount()` 2),
  while `invoke(Supplier)` rethrows the last `RuntimeException` itself.
- Never retry non-idempotent calls blindly (a POST that may have succeeded), and don't retry 4xx.

## Virtual threads

`spring.threads.virtual.enabled=true` (Java 21+). Measured on 4.1.2 with Tomcat: request threads
report `Thread.currentThread().isVirtual() == true` and are named `tomcat-handler-N`; without the
property they are platform threads named `http-nio-...-exec-N`. Boot also switches the
`applicationTaskExecutor`, the scheduler and (since 4.0) its auto-configured JDK `HttpClient`s to
virtual threads. On JDK 24+, `synchronized` no longer pins a carrier thread (JEP 491), so the old
advice to replace every `synchronized` with `ReentrantLock` is only relevant on Java 21-23. Keep
connection pools sized for the database, not for the number of virtual threads.
