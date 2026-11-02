# Jackson 3 in Spring Boot 4

Checked against Spring Boot 4.1.2 with Jackson 3.1.7 (`tools.jackson.core:jackson-databind`) and
`jackson-annotations` 2.x (unchanged package `com.fasterxml.jackson.annotation`).

## What is on the classpath

`spring-boot-starter-webmvc` brings `spring-boot-starter-jackson`, which brings Jackson 3 only. In a
default Boot 4.1.2 web app there is no `com.fasterxml.jackson.databind` at all, so Jackson 2 code
fails at compile time with `package com.fasterxml.jackson.databind does not exist`. The deprecated
`spring-boot-jackson2` module exists for libraries that cannot move yet (Jersey, for example); it
configures a separate Jackson 2 `ObjectMapper` under `spring.jackson2.*` and Spring MVC still uses
Jackson 3.

## Rename map (the ones REST code hits)

| Jackson 2 | Jackson 3 |
| --- | --- |
| `com.fasterxml.jackson.databind.*` | `tools.jackson.databind.*` |
| `com.fasterxml.jackson.core.JsonGenerator`, `JsonParser` | `tools.jackson.core.JsonGenerator`, `JsonParser` |
| `ObjectMapper` (mutable, `configure`, `setX`) | `JsonMapper` (immutable): `JsonMapper.builder()...build()`, `mapper.rebuild()` |
| `JsonSerializer<T>`, `StdSerializer<T>` | `ValueSerializer<T>`, `tools.jackson.databind.ser.std.StdSerializer<T>` |
| `JsonDeserializer<T>`, `StdDeserializer<T>` | `ValueDeserializer<T>`, `tools.jackson.databind.deser.std.StdDeserializer<T>` |
| `SerializerProvider` | `SerializationContext` |
| `JsonProcessingException`, `JsonMappingException` | `JacksonException`, `DatabindException` (both unchecked) |
| `JsonParseException`, `JsonGenerationException` | `StreamReadException`, `StreamWriteException` |
| `Module`, `SimpleModule` | `JacksonModule`, `tools.jackson.databind.module.SimpleModule` |
| `TextNode`, `node.asText()`, `node.isTextual()` | `StringNode`, `node.asString()`, `node.isString()` |
| `p.getCodec().readTree(p)` | `ctxt.readTree(p)` |
| `gen.writeStringField`, `writeNumberField`, `writeFieldName` | `writeStringProperty`, `writeNumberProperty`, `writeName` |
| `p.nextFieldName()`, `JsonToken.FIELD_NAME` | `p.nextName()`, `JsonToken.PROPERTY_NAME` |
| `gen.writeObject(pojo)` | `gen.writePOJO(pojo)` |
| `@JsonSerialize`, `@JsonDeserialize`, `@JsonNaming` (`databind.annotation`) | same names in `tools.jackson.databind.annotation` |
| `SerializationFeature.WRITE_DATES_AS_TIMESTAMPS` and other date features | `tools.jackson.databind.cfg.DateTimeFeature` |
| enum features (`WRITE_ENUMS_USING_TO_STRING`, `READ_ENUMS_USING_TO_STRING`, ...) | `tools.jackson.databind.cfg.EnumFeature` |
| `mapper.setSerializationInclusion(NON_NULL)` | `builder.changeDefaultPropertyInclusion(v -> v.withValueInclusion(NON_NULL))` |
| `jackson-datatype-jsr310`, `-jdk8`, `-parameter-names` | built into databind; nothing to register |

## Boot integration renames

| Boot 3 | Boot 4 |
| --- | --- |
| `@JsonComponent` | `@JacksonComponent` (`org.springframework.boot.jackson`) |
| `@JsonMixin` | `@JacksonMixin` |
| `JsonObjectSerializer`, `JsonValueDeserializer` | `ObjectValueSerializer`, `ObjectValueDeserializer` |
| `Jackson2ObjectMapperBuilderCustomizer` | `JsonMapperBuilderCustomizer` (`org.springframework.boot.jackson.autoconfigure`) |
| `@Bean ObjectMapper` replaces Boot's mapper | **ignored**; define `@Bean JsonMapper` to replace it |
| `spring.jackson.read.*`, `spring.jackson.write.*` (JSON features) | `spring.jackson.json.read.*`, `spring.jackson.json.write.*`; since 4.1, `spring.jackson.read.*`/`write.*` take the format-neutral `StreamReadFeature`/`StreamWriteFeature` |
| `spring.jackson.parser.*` | `spring.jackson.json.read.*` where an equivalent exists |
| contributing an `HttpMessageConverter` bean for JSON | `ServerHttpMessageConvertersCustomizer` / `ClientHttpMessageConvertersCustomizer` |

Properties that still work as before: `spring.jackson.property-naming-strategy`,
`spring.jackson.default-property-inclusion`, `spring.jackson.serialization.*`,
`spring.jackson.deserialization.*`, `spring.jackson.mapper.*`, `spring.jackson.time-zone`. New:
`spring.jackson.datatype.enum.*`, `spring.jackson.datatype.datetime.*`,
`spring.jackson.use-jackson2-defaults`, `spring.jackson.find-and-add-modules` (modules are
auto-detected; default `true`).

## Measured: the ObjectMapper bean

```java
@Bean
ObjectMapper objectMapper() {             // tools.jackson.databind.ObjectMapper
  return JsonMapper.builder().propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE).build();
}
```

On 4.1.2 the context then has two mappers, `objectMapper` and `jacksonJsonMapper`; responses stay
camelCase because Spring MVC's converter uses `jacksonJsonMapper`. With `@Primary` on the bean, the
context fails: `NoUniqueBeanDefinitionException ... more than one 'primary' bean found among
candidates: [objectMapper, jacksonJsonMapper]`.

## Measured: default changes in a Boot 4.1.2 web app

Same controller and records, Boot 4.1.2 defaults vs `spring.jackson.use-jackson2-defaults=true`.
The "Restore with" properties were measured too, set together without `use-jackson2-defaults`:

| Case | Jackson 2 behaviour | Jackson 3 default | Restore with |
| --- | --- | --- | --- |
| enum with `toString()` override, response | `"BOARDING"` | `"Now boarding"` | `spring.jackson.datatype.enum.write-enums-using-to-string=false` |
| same enum, request `"BOARDING"` | accepted | **400** | `spring.jackson.datatype.enum.read-enums-using-to-string=false` |
| same enum, request `"Now boarding"` | 400 | accepted | (as above) |
| `{"name":"n"}` into `record In(String name, int count)` | `count = 0` | **400** | `spring.jackson.deserialization.fail-on-null-for-primitives=false` |
| `{"name":"n","count":null}` | `count = 0` | **400** | (as above) |
| `{"name":"n","count":1} {}` | accepted | **400** | `spring.jackson.deserialization.fail-on-trailing-tokens=false` |
| getter-based class with fields `zeta, alpha, status, count` | that order | `alpha, count, status, zeta` | `spring.jackson.mapper.sort-properties-alphabetically=false` |
| record components `zeta, alpha` | that order | that order | - |
| `java.util.Date(0)` | `"1970-01-01T00:00:00.000+00:00"` | `"1970-01-01T00:00:00.000Z"` | a `@JsonFormat` or the Jackson 2 defaults switch |
| unknown property | accepted | accepted | - (Boot 3 turned `FAIL_ON_UNKNOWN_PROPERTIES` off; Jackson 3 has it off by default) |
| `Instant` with nanos | `"2026-01-02T03:04:05.123456789Z"` | same | - |
| `Duration.ofSeconds(90)` | `"PT1M30S"` | same | - |

The three enum and primitive rows were also checked on a Boot 3.5.16 build of the same API: it
accepted enum names, rejected labels and read an omitted `boolean` as `false`. Other Jackson 3
default flips that the release notes list (not all observable in a plain REST app):
`MapperFeature.DEFAULT_VIEW_INCLUSION` off, `USE_GETTERS_AS_SETTERS` off,
`ALLOW_FINAL_FIELDS_AS_MUTATORS` off, `FIX_FIELD_NAME_UPPER_CASE_PREFIX` on, and UTC as the default
time zone.

Which to choose on an upgrade:
- Public contract with clients you don't control: restore each changed behaviour explicitly
  (properties or a `JsonMapperBuilderCustomizer`), and pin it with a test that sends the old
  requests.
- Internal API: accept the stricter defaults, but change clients first.
- `use-jackson2-defaults=true` is a fast, reversible stopgap. It is a Jackson 3 setting, not the
  Jackson 2 module.

## Recipes

Customizer covering a typical contract:

```java
@Bean
JsonMapperBuilderCustomizer timetableJson() {
  return builder -> builder
      .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
      .changeDefaultPropertyInclusion(v -> v.withValueInclusion(JsonInclude.Include.NON_NULL))
      .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
      .disable(DateTimeFeature.WRITE_DATES_AS_TIMESTAMPS);   // already the Jackson 3 default
}
```

A module bean instead of `@JacksonComponent` (Boot registers every `JacksonModule` bean):

```java
@Bean
JacksonModule fareModule() {
  return new SimpleModule("fares")
      .addSerializer(Fare.class, new FareSerializer())
      .addDeserializer(Fare.class, new FareDeserializer());
}
```

A mixin for a type you can't edit, when annotations are enough:

```java
@JacksonMixin(Station.class)
abstract class StationMixin {
  @JsonProperty("code") abstract String code();
  @JsonIgnore abstract String internalNotes();
}
```

Errors inside a deserializer: `ctxt.reportInputMismatch(Target.class, "message %s", arg)` or
`throw ctxt.weirdStringException(text, Target.class, "why")`. Both end as
`HttpMessageNotReadableException` and a 400 in Spring MVC; so did a bare `IllegalArgumentException`
and `NumberFormatException` thrown from `deserialize` (measured).

## Tests

- `@JsonTest` (`org.springframework.boot.test.autoconfigure.json`) and `JacksonTester`
  (`org.springframework.boot.test.json`) still exist for mapper-only tests.
- `@WebMvcTest` includes `@JacksonComponent` beans; it does not include a `JsonMapperBuilderCustomizer`
  that lives in a `@Configuration` class (measured: snake_case and null exclusion missing in the
  slice). Use properties for the contract, `@Import` the configuration, or test with
  `@SpringBootTest`.
