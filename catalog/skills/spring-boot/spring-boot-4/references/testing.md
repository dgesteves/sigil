# Testing Spring MVC on Boot 4

Checked against Spring Boot 4.1.2, Spring Framework 7.0.10, JUnit Jupiter 6.0.3, Mockito 5.23.0,
AssertJ 3.27.7.

## Dependencies

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-webmvc-test</artifactId>
  <scope>test</scope>
</dependency>
```

`spring-boot-starter-webmvc-test` brings `spring-boot-starter-test` (JUnit, AssertJ, Mockito,
Hamcrest, JSONPath, JSONassert, Awaitility, `spring-test`), `spring-boot-webmvc-test` (the slice and
MockMvc auto-configuration), `spring-boot-starter-jackson-test` and `spring-boot-resttestclient`
(`TestRestTemplate`). `spring-boot-starter-test` on its own has no `@WebMvcTest` or
`@AutoConfigureMockMvc`. Other technologies have their own test starters
(`spring-boot-starter-restclient-test` for `@RestClientTest`, now in
`org.springframework.boot.restclient.test.autoconfigure`, with `MockRestServiceServer`;
`spring-boot-starter-validation-test`, `spring-boot-starter-security-test` for `@WithMockUser`).

## Annotation and class locations

| What | Boot 3.x | Boot 4.x |
| --- | --- | --- |
| `@WebMvcTest` | `org.springframework.boot.test.autoconfigure.web.servlet` | `org.springframework.boot.webmvc.test.autoconfigure` |
| `@AutoConfigureMockMvc` | `org.springframework.boot.test.autoconfigure.web.servlet` | `org.springframework.boot.webmvc.test.autoconfigure` |
| `@MockBean`, `@SpyBean` | `org.springframework.boot.test.mock.mockito` (deprecated in 3.4) | **removed** |
| `@MockitoBean`, `@MockitoSpyBean` | `org.springframework.test.context.bean.override.mockito` (since 3.4) | same |
| `TestRestTemplate` | `org.springframework.boot.test.web.client` | `org.springframework.boot.resttestclient` |
| `@AutoConfigureTestRestTemplate` | - | `org.springframework.boot.resttestclient.autoconfigure` |
| `RestTestClient` | - | `org.springframework.test.web.servlet.client` (Framework 7) |
| `@AutoConfigureRestTestClient` | - | `org.springframework.boot.resttestclient.autoconfigure` |
| `MockMvcTester` | `org.springframework.test.web.servlet.assertj` (Framework 6.2) | same |
| `@LocalServerPort` | `org.springframework.boot.test.web.server` | same |
| `@SpringBootTest`, `@DynamicPropertySource` | unchanged | unchanged |
| `@JsonTest`, `JacksonTester` | `...test.autoconfigure.json`, `...test.json` | same |

What `@SpringBootTest` no longer gives you implicitly:
- `MockMvc`: add `@AutoConfigureMockMvc`.
- `TestRestTemplate` with `RANDOM_PORT`: add `@AutoConfigureTestRestTemplate`, and have
  `spring-boot-restclient` on the runtime classpath (the restclient starter).
- `WebTestClient`: add `@AutoConfigureWebTestClient` (`org.springframework.boot.webtestclient.autoconfigure`,
  module `spring-boot-webtestclient`).

`MockitoTestExecutionListener` is gone; if plain `@Mock`/`@Captor` fields stop being initialized in
a Spring test, add `@ExtendWith(MockitoExtension.class)`.

## Port table for common test code

```java
// Boot 3
@WebMvcTest(DepartureController.class)
class DepartureControllerTest {
  @Autowired MockMvc mvc;
  @MockBean TimetableService timetable;
}

// Boot 4
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@WebMvcTest(DepartureController.class)
class DepartureControllerTest {
  @Autowired MockMvc mvc;
  @MockitoBean TimetableService timetable;
}
```

```java
// Boot 4, real HTTP, keeping TestRestTemplate
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
class FareApiTest {
  @Autowired TestRestTemplate http;   // org.springframework.boot.resttestclient.TestRestTemplate
}

// Boot 4, real HTTP, RestTestClient (measured)
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@AutoConfigureRestTestClient
class FareApiTest {
  @Autowired RestTestClient client;

  @Test
  void quote() {
    client.get().uri("/fares/quote?from=LIS&to=OPO").exchange()
        .expectStatus().isOk()
        .expectBody().jsonPath("$.total.value").isEqualTo("23.40");
  }
}
```

`@MockitoBean` fields must be in the test class (or a superclass or `@Nested` enclosing class), not
in a `@Configuration`. To share mocks, put `@MockitoBean(types = {A.class, B.class})` on the test
class or on a custom annotation.

## MockMvcTester (AssertJ)

```java
@WebMvcTest(DepartureController.class)
class DepartureControllerTest {
  @Autowired MockMvcTester mvc;

  @Test
  void rejectsBadStation() {
    assertThat(mvc.get().uri("/stations/lisbon/departures"))
        .hasStatus(HttpStatus.BAD_REQUEST)
        .bodyJson().extractingPath("$.errors[0].field").isEqualTo("stationCode");
  }
}
```

`MockMvcTester` is auto-configured wherever `MockMvc` is (measured in a `@WebMvcTest`, including
`hasStatus`, `bodyText()` and `bodyJson().extractingPath(...)`).

## Slices and what they load

- `@WebMvcTest` loads controllers, `@ControllerAdvice`, `@JacksonComponent`, `JacksonModule` beans,
  converters, filters and `WebMvcConfigurer`s. It does not load `@Service`, `@Component` or
  `@Configuration` classes from component scanning: mock collaborators with `@MockitoBean`, and
  `@Import` configuration you need. A `JsonMapperBuilderCustomizer` in a `@Configuration` class is
  therefore missing in the slice (measured); JSON contract tests belong in `@SpringBootTest` or need
  the `@Import`.
- `@SpringBootTest` loads everything; one context is cached per distinct configuration and shared
  across test classes. Mutable singletons (in-memory stores) carry state between classes, so don't
  assert on global counts or on "the list has 2 entries" unless the test owns that state.

## Real HTTP without Boot test helpers

When a test must not depend on which client the app uses (or must also run on Boot 3), use
`@SpringBootTest(webEnvironment = RANDOM_PORT)`, `@LocalServerPort`, `java.net.http.HttpClient` and
`org.springframework.boot.json.BasicJsonParser` (present in Boot 3 and 4; numbers and booleans come
back loosely typed, so compare with `hasToString`).

## Build tool notes

- Maven offline: `mvn -o test`. A test starter added to the POM must already be in the local
  repository.
- JDK 25 prints "Mockito is currently self-attaching to enable the inline-mock-maker"; tests still
  run. To silence it, add Mockito as a `-javaagent` in the Surefire `argLine` (see Mockito's docs).
