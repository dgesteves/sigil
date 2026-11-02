# Upgrading a Boot 3.5 service to Boot 4.x

Checked against Spring Boot 4.1.2 and the official Spring Boot 4.0 migration guide. Baselines: Java
17+ (25 recommended), Jakarta EE 11 (Servlet 6.1), Spring Framework 7, Kotlin 2.2+, Hibernate 7,
Hibernate Validator 9, Jackson 3, JUnit 6 (managed by Boot), Tomcat 11, Jetty 12.1. Undertow support
is removed.

Boot 4.1 removed the classes, methods and properties that 4.0 deprecated (4.1 release notes). When
going from 3.5 straight to 4.1, move to the new names directly rather than to 4.0's deprecated
bridges. The renamed starters (`spring-boot-starter-web` and friends) still resolve in 4.1.2.

## Order of work

1. Latest 3.5.x, no deprecation warnings (`@MockBean` → `@MockitoBean` is already possible there).
2. Bump the parent (or the Boot Gradle plugin and BOM).
3. Starters (below). If the change is large, the `spring-boot-starter-classic` and
   `spring-boot-starter-test-classic` starters bring every module back so you can fix imports first,
   then replace them with the real starters. Don't ship with them.
4. Compile errors: Jackson, tests, `RestTemplateBuilder`, moved Boot packages.
5. Behaviour: Jackson 3 defaults (see jackson-3.md), properties renamed, and anything the release
   notes call out for your stack.
6. Tests: keep every existing test; port imports and annotations.

To find where a class went, look inside the jars you already have instead of guessing:

```sh
ls .m2/repository/org/springframework/boot/                      # which modules you have
unzip -l .m2/repository/org/springframework/boot/spring-boot-restclient/4.1.2/spring-boot-restclient-4.1.2.jar | grep RestTemplateBuilder
javap -cp .m2/repository/org/springframework/boot/spring-boot-restclient/4.1.2/spring-boot-restclient-4.1.2.jar org.springframework.boot.restclient.RestTemplateBuilder | grep -i timeout
```

## Starters

| Boot 3 | Boot 4 |
| --- | --- |
| `spring-boot-starter-web` | `spring-boot-starter-webmvc` (old name deprecated) |
| `spring-boot-starter-web-services` | `spring-boot-starter-webservices` |
| `spring-boot-starter-aop` | `spring-boot-starter-aspectj` |
| `spring-boot-starter-oauth2-client` | `spring-boot-starter-security-oauth2-client` |
| `spring-boot-starter-oauth2-resource-server` | `spring-boot-starter-security-oauth2-resource-server` |
| `spring-boot-starter-oauth2-authorization-server` | `spring-boot-starter-security-oauth2-authorization-server` |
| `spring-boot-starter-tomcat` for WAR deployment | `spring-boot-starter-tomcat-runtime` |
| `RestTemplateBuilder`/`RestClient.Builder` came with web | `spring-boot-starter-restclient` |
| `spring-boot-starter-test` for everything | `spring-boot-starter-<tech>-test` per technology (each includes `spring-boot-starter-test`) |
| `spring-boot-starter-batch` stored metadata in your DB | in memory; `spring-boot-starter-batch-jdbc` keeps the old behaviour |
| Flyway/Liquibase as plain dependencies | `spring-boot-starter-flyway` / `spring-boot-starter-liquibase` |

Spring Retry is no longer managed: a `spring-retry` dependency without a version fails to resolve.
Use Framework 7's `@Retryable` (http-and-resilience.md) or pin a version yourself.

## Classes and packages that moved

| Boot 3 | Boot 4 |
| --- | --- |
| `org.springframework.boot.web.client.RestTemplateBuilder` | `org.springframework.boot.restclient.RestTemplateBuilder` |
| `RestTemplateBuilder.setConnectTimeout/setReadTimeout(Duration)` | `connectTimeout(Duration)` / `readTimeout(Duration)` |
| `org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer` | `org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer` |
| `org.springframework.boot.jackson.JsonComponent` | `org.springframework.boot.jackson.JacksonComponent` |
| `org.springframework.boot.autoconfigure.domain.EntityScan` | `org.springframework.boot.persistence.autoconfigure.EntityScan` |
| `org.springframework.boot.env.EnvironmentPostProcessor` | `org.springframework.boot.EnvironmentPostProcessor` |
| `org.springframework.boot.BootstrapRegistry` and friends | `org.springframework.boot.bootstrap` |
| `org.springframework.lang.Nullable` for Boot APIs | `org.jspecify.annotations.Nullable` |
| test annotations | see testing.md |

Unchanged and safe: `@SpringBootApplication`, `@ConfigurationProperties` (records, `@DefaultValue`),
`@ConfigurationPropertiesScan`, `@SpringBootTest`, `@LocalServerPort`, `SpringBootVersion`.

## Properties that moved

| Boot 3 | Boot 4 |
| --- | --- |
| `spring.http.client.connect-timeout`, `read-timeout`, `redirects`, `ssl.bundle` | `spring.http.clients.*` |
| `spring.http.client.factory` | `spring.http.clients.imperative.factory` |
| `spring.http.reactiveclient.*` | `spring.http.clients.*` / `spring.http.clients.reactive.connector` |
| `spring.jackson.read.*`, `spring.jackson.write.*` (JSON features) | `spring.jackson.json.read.*`, `spring.jackson.json.write.*` (the old keys now mean stream features) |
| `spring.dao.exceptiontranslation.enabled` | `spring.persistence.exceptiontranslation.enabled` |
| `spring.session.redis.*` | `spring.session.data.redis.*` |
| `spring.data.mongodb.host/port/uri/...` | `spring.mongodb.*` |
| `management.tracing.enabled` | `management.tracing.export.enabled` |

The `spring-boot-properties-migrator` module (4.1.2 is on Maven Central) reports renamed properties
at startup when it is on the runtime classpath; remove it afterwards.

## Behaviour that changes without a compile error

- Jackson 3 defaults: enums written and read with `toString()`, missing or null primitives rejected,
  trailing tokens rejected, getter-based properties sorted alphabetically, `java.util.Date` formatted
  with `Z`. See jackson-3.md for the measured table and how to restore each.
- A `@Bean ObjectMapper` no longer replaces Boot's mapper (ignored by Spring MVC).
- `@SpringBootTest` no longer provides `MockMvc`, `TestRestTemplate` or `WebTestClient` without the
  `@AutoConfigure...` annotation.
- Liveness and readiness health groups are enabled by default.
- DevTools live reload is off by default (`spring.devtools.livereload.enabled`).
- Log files default to UTF-8.
- Optional dependencies are no longer packed into the executable jar
  (`<includeOptional>true</includeOptional>` restores it).

## Verify the upgrade

- Build and test offline if the build is hermetic.
- Replay recorded 3.5 requests and compare responses byte for byte where clients parse them
  (enum values, money, dates, nulls, error bodies, status codes).
- Check `SpringBootVersion.getVersion()` and that `com.fasterxml.jackson.databind.ObjectMapper` is
  absent from the classpath (`ClassUtils.isPresent(...)`) if you mean to be fully on Jackson 3.
