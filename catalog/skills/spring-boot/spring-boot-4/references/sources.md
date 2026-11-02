# Sources

Checked in November 2026 against Spring Boot 4.1.2, the latest GA release on Maven Central
(4.0.9 is the other maintained line; 4.2.0-RC1 is a release candidate), on the
`maven:3.9.16-eclipse-temurin-25` image (Temurin 25.0.4.1).

## Versions (Maven Central)

- `org.springframework.boot:spring-boot` metadata: GA versions up to 4.1.2 and 3.5.16.
  https://repo1.maven.org/maven2/org/springframework/boot/spring-boot/maven-metadata.xml
- `spring-boot-dependencies-4.1.2.pom`: Spring Framework 7.0.10, Jackson 3.1.7 (`jackson-bom`),
  Jackson 2 compatibility BOM 2.21.7, Hibernate Validator 9.1.5.Final, Jakarta Validation 3.1.1,
  JUnit Jupiter 6.0.3, Mockito 5.23.0, AssertJ 3.27.7, Tomcat 11.0.27; no `spring-retry` entry.
  https://repo1.maven.org/maven2/org/springframework/boot/spring-boot-dependencies/4.1.2/
- Starters present for 4.1.2: `spring-boot-starter-webmvc`, `-webmvc-test`, `-restclient`,
  `-restclient-test`, `-validation`, `-validation-test`, `-jackson`, `-jackson-test`, `-classic`,
  `-test-classic`, `spring-boot-starter-web` (deprecated name), `spring-boot-resttestclient`,
  `spring-boot-webtestclient`, `spring-boot-jackson2`, `spring-boot-properties-migrator`.

## Spring Boot

- Spring Boot 4.0 Migration Guide: modules and starters, renamed starters, classic starters,
  Jackson 3 renames and properties, `spring.jackson.use-jackson2-defaults`, `JsonMapper` vs
  `ObjectMapper` beans, `HttpMessageConverters` deprecation, test changes (`@AutoConfigureMockMvc`,
  `@AutoConfigureTestRestTemplate`, `TestRestTemplate` package, `@MockBean` removal,
  `MockitoTestExecutionListener`), Spring Retry no longer managed, moved packages, renamed
  properties. https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide
- Spring Boot 4.0 Release Notes: HTTP service client auto-configuration, API versioning properties,
  `RestTestClient`, virtual threads for JDK `HttpClient`s, `management.tracing.export.enabled`,
  dependency baselines. https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Release-Notes
- Spring Boot 4.1 Release Notes: 4.0 deprecations removed, `spring.jackson.read.*`/`write.*` for
  common stream features, `spring.http.clients.cookie-handling`, `TestRestTemplate.withCookieHandling`.
  https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.1-Release-Notes
- JSON (Jackson) reference: https://docs.spring.io/spring-boot/reference/features/json.html
- REST clients and HTTP service clients: https://docs.spring.io/spring-boot/reference/io/rest-client.html
- Servlet web applications (problem details, error handling): https://docs.spring.io/spring-boot/reference/web/servlet.html
- Virtual threads (`spring.threads.virtual.enabled`): https://docs.spring.io/spring-boot/reference/features/spring-application.html
- Testing Spring Boot applications: https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html
- Configuration property names, types, defaults and deprecations: read from
  `META-INF/spring-configuration-metadata.json` in the 4.1.2 module jars (`spring-boot-jackson`,
  `spring-boot-http-client`, `spring-boot-webmvc`, `spring-boot-validation`, `spring-boot`).

## Spring Framework 7

- Method validation in Spring MVC, `HandlerMethodValidationException`, and why class-level
  `@Validated` switches to AOP validation:
  https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html
- Error responses, `ProblemDetail`, `ResponseEntityExceptionHandler`, message codes for problem
  details: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html
- API versioning: https://docs.spring.io/spring-framework/reference/web/webmvc-versioning.html
- Resilience (`@Retryable`, `@ConcurrencyLimit`, `@EnableResilientMethods`, `RetryTemplate`):
  https://docs.spring.io/spring-framework/reference/core/resilience.html
- REST clients and HTTP interface clients (`@HttpExchange`, `@ImportHttpServices`):
  https://docs.spring.io/spring-framework/reference/integration/rest-clients.html
- `RestTestClient`: https://docs.spring.io/spring-framework/reference/testing/resttestclient.html
- `MockMvcTester`: https://docs.spring.io/spring-framework/reference/testing/mockmvc/assertj.html
- `@MockitoBean`: https://docs.spring.io/spring-framework/reference/testing/annotations/integration-spring/annotation-mockitobean.html

## Jackson 3

- Migrating to Jackson 3: package and group changes, class renames, default changes
  (`SORT_PROPERTIES_ALPHABETICALLY`, `FAIL_ON_TRAILING_TOKENS`, `FAIL_ON_NULL_FOR_PRIMITIVES`,
  `READ_ENUMS_USING_TO_STRING`, `WRITE_ENUMS_USING_TO_STRING`, `DateTimeFeature`), leftover 2.x
  databind annotations being ignored.
  https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md

## Java

- JEP 491, synchronized virtual threads without pinning (JDK 24):
  https://openjdk.org/jeps/491

## Class and API facts read from the 4.1.2 jars

With `unzip -l` and `javap` on the artifacts in a local Maven repository:
- Packages of `WebMvcTest`, `AutoConfigureMockMvc` (`spring-boot-webmvc-test`), `TestRestTemplate`,
  `AutoConfigureTestRestTemplate`, `AutoConfigureRestTestClient` (`spring-boot-resttestclient`),
  `AutoConfigureWebTestClient` (`spring-boot-webtestclient`), `RestClientTest`
  (`spring-boot-restclient-test`), `JsonTest`, `JacksonTester`, `LocalServerPort`,
  `JacksonComponent`, `JacksonMixin`, `JsonMapperBuilderCustomizer`, `RestTemplateBuilder`
  (`spring-boot-restclient`), `ProblemDetailsExceptionHandler` (`spring-boot-webmvc`),
  `RestClientHttpServiceGroupConfigurer` (`spring-web`).
- `RestTemplateBuilder` 4.1.2 has `connectTimeout`/`readTimeout` and no `set...` methods.
- `Retryable` annotation defaults (maxRetries 3, delay 1000, jitter 0, multiplier 1.0),
  `ConcurrencyLimit.ThrottlePolicy` (`BLOCK`, `REJECT`), `RetryPolicy.builder()`,
  `RetryTemplate.execute`/`invoke`.
- `HandlerMethodValidationException` (`getParameterValidationResults`, `visitResults`, `Visitor`
  methods), `ParameterValidationResult.getContainerIndex()`.
- Jackson 3.1.7: `ValueSerializer`, `ValueDeserializer`, `EnumFeature`, `DateTimeFeature`,
  `DeserializationFeature`, `MapperFeature` constants.
- `HttpClientProperties` (service client groups): `baseUrl`, `defaultHeader`, `apiversion`, plus
  the timeouts of `HttpClientSettingsProperties`.

## Behaviour measured by running it

Spring Boot 4.1.2 applications built offline in the image above, exercised with MockMvc, real HTTP
(`RANDOM_PORT`), `RestTestClient` and plain JUnit:
- Jackson 3 defaults versus `spring.jackson.use-jackson2-defaults=true`: enum `toString()` used for
  writing and reading, missing and null primitives rejected, trailing tokens rejected, getter-based
  properties sorted alphabetically while records keep component order, `java.util.Date` with `Z`,
  ISO `Instant` with nanoseconds and `Duration` as `PT1M30S`, unknown properties accepted. Each
  restoring property (`datatype.enum.*`, `deserialization.fail-on-null-for-primitives`,
  `deserialization.fail-on-trailing-tokens`, `mapper.sort-properties-alphabetically`) checked.
- A `@Bean ObjectMapper` is ignored by Spring MVC (two mapper beans, Boot's used); with `@Primary`,
  `NoUniqueBeanDefinitionException` at startup.
- `JsonMapperBuilderCustomizer` + `@JacksonComponent` take effect; `@WebMvcTest` includes the
  component but not a customizer from a `@Configuration` class.
- Exceptions thrown inside a `ValueDeserializer` (including `IllegalArgumentException` and
  `NumberFormatException`) become 400.
- Validation: class-level `@Validated` → `ConstraintViolationException`; built-in method validation
  → `HandlerMethodValidationException` for parameters, for mixed parameter + body (one exception
  with both), and for list bodies (`ParameterErrors` per element with its index);
  `MethodArgumentNotValidException` for a lone `@Valid @RequestBody`; class-level `@Validated` with
  invalid path and body → only body errors. Default problem detail texts for each exception.
- With `spring.mvc.problemdetails.enabled=true`, a plain `@RestControllerAdvice` handling
  `MethodArgumentNotValidException`/`HandlerMethodValidationException` did not run until ordered
  `@Order(Ordered.HIGHEST_PRECEDENCE)`; a `ResponseEntityExceptionHandler` subclass took over all
  MVC exceptions with problem details.
- `@ImportHttpServices` group with `spring.http.serviceclient.<group>.base-url` against a local
  stub; `RestClient` 404 → `HttpClientErrorException.NotFound`, read timeout →
  `ResourceAccessException`.
- `@Retryable(maxRetries = 3)` → 4 calls, last exception rethrown; no `includes` retries any
  exception; `RetryTemplate.execute` → `RetryException`, `invoke` → the last exception.
- API versioning with only `spring.mvc.apiversion.use.header`: missing version → 400 on versioned
  and unversioned endpoints; `2` matches `2.0`; unknown version → 400.
- `spring.threads.virtual.enabled=true`: request threads are virtual (`tomcat-handler-N`).
- `MockMvcTester` in a `@WebMvcTest` (`hasStatus`, `bodyText`, `bodyJson().extractingPath`),
  `RestTestClient` with `@AutoConfigureRestTestClient`, `TestRestTemplate` with
  `@AutoConfigureTestRestTemplate`.

The same API built on Spring Boot 3.5.16 (Jackson 2.21.4) accepted enum names, rejected enum labels,
read an omitted `boolean` as `false` and rejected unknown properties when the app enabled
`FAIL_ON_UNKNOWN_PROPERTIES`, which is the baseline the upgrade task in the proof suite holds 4.1.2 to.
