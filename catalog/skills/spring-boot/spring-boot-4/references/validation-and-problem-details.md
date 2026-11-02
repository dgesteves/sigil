# Validation and problem details in Spring MVC 7

Checked against Spring Boot 4.1.2 (Spring Framework 7.0.10, Hibernate Validator 9.1.5, Jakarta
Validation 3.1). Requires `spring-boot-starter-validation`.

## Two validation mechanisms, and why it matters which one runs

1. **Built-in method validation** (Spring MVC, since Framework 6.1). Applies when a handler method
   has constraint annotations directly on parameters (`@RequestParam @Max(200) int limit`,
   `@PathVariable @Pattern(...)`), or `@Valid` on a container-typed parameter (`List`, `Map`).
   Spring MVC validates all arguments together, before invoking the method, and raises one
   `HandlerMethodValidationException` (400) that holds every parameter's and every `@Valid` body's
   errors.
2. **Argument-level `@Valid`**. With no constrained parameters, a `@Valid @RequestBody` or
   `@ModelAttribute` is validated while it is resolved and raises
   `MethodArgumentNotValidException` (400) for that one argument.

A controller with class-level `@Validated` switches (1) off: Spring MVC leaves method validation to
the `MethodValidationPostProcessor` AOP proxy, which throws `jakarta.validation.ConstraintViolationException`.
Nothing maps that to 400 by default. Measured on 4.1.2:

| Controller | Request | Result |
| --- | --- | --- |
| class `@Validated`, `@RequestParam @Min(1) @Max(100) int size` | `?size=0` | `ConstraintViolationException`, 500 in a running server |
| no `@Validated`, same parameter | `?size=0` | `HandlerMethodValidationException`, 400 |
| no `@Validated`, `@PathVariable @Pattern("[A-Z]{3}")` | `/abcd` | `HandlerMethodValidationException`, 400 |
| `@Valid @RequestBody Leg` + `@RequestParam @Max(5) int priority` | bad body and bad param | one `HandlerMethodValidationException` with both |
| same | bad body only | `HandlerMethodValidationException` |
| `@Valid @RequestBody Leg` alone | bad body | `MethodArgumentNotValidException` |
| `@RequestBody List<@Valid Leg>` or `@Valid @RequestBody List<Leg>` | bad element | `HandlerMethodValidationException` |
| class `@Validated` + `@PathVariable @Pattern` + `@Valid @RequestBody` | bad path and bad body | `MethodArgumentNotValidException`, path error missing |
| any | `?size=abc` | `MethodArgumentTypeMismatchException`, 400 |
| any | `size` missing, no default | `MissingServletRequestParameterException`, 400 |
| any | malformed JSON, missing primitive, unknown enum constant | `HttpMessageNotReadableException`, 400 |

So: no `@Validated` on controllers. If an old code base relies on the AOP route,
`spring.validation.method.adapt-constraint-violations=true` ("Whether to adapt ConstraintViolations
to MethodValidationResult") makes AOP-validated beans throw `MethodValidationException` instead,
which is still not the exception Spring MVC's handlers expect. Remove the annotation instead.

## Problem details

Two ways to get RFC 9457 bodies (`application/problem+json`):

- `spring.mvc.problemdetails.enabled=true`: Boot registers `ProblemDetailsExceptionHandler`, a
  `ResponseEntityExceptionHandler` subclass, only when no other `ResponseEntityExceptionHandler`
  bean exists. Default bodies measured on 4.1.2:

  | Exception | `detail` |
  | --- | --- |
  | `HandlerMethodValidationException` | `"Validation failure"` |
  | `MethodArgumentNotValidException` | `"Invalid request content."` |
  | `HttpMessageNotReadableException` | `"Failed to read request"` |
  | `MissingServletRequestParameterException` | `"Required parameter 'size' is not present."` |
  | `MethodArgumentTypeMismatchException` | `"Failed to convert 'size' with value: 'abc'"` |

  Every body also has `title` (`"Bad Request"`), `status` and `instance` (the request path). No
  field list.
- Your own `@RestControllerAdvice` that **extends `ResponseEntityExceptionHandler`**: it handles
  every Spring MVC exception as a `ProblemDetail`, and you override the two validation hooks to add
  the fields. Boot's handler backs off.

Ordering trap (measured): property on, plus a plain `@RestControllerAdvice` with
`@ExceptionHandler(MethodArgumentNotValidException.class)` and
`@ExceptionHandler(HandlerMethodValidationException.class)` → Boot's handler is ordered first and
answers; yours never runs and the response has no `errors`. `@Order(Ordered.HIGHEST_PRECEDENCE)` on
your advice fixes it; extending `ResponseEntityExceptionHandler` is cleaner.

## Full handler with an `errors` array

```java
@RestControllerAdvice
class TimetableProblems extends ResponseEntityExceptionHandler {

  @Override
  protected ResponseEntity<Object> handleMethodArgumentNotValid(
      MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
    List<Map<String, String>> errors = new ArrayList<>();
    ex.getBindingResult().getFieldErrors().forEach(e -> errors.add(error(e.getField(), e)));
    ex.getBindingResult().getGlobalErrors().forEach(e -> errors.add(error(e.getObjectName(), e)));
    return withErrors(ex.getBody(), errors, ex, headers, status, request);
  }

  @Override
  protected ResponseEntity<Object> handleHandlerMethodValidationException(
      HandlerMethodValidationException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
    List<Map<String, String>> errors = new ArrayList<>();
    for (ParameterValidationResult result : ex.getParameterValidationResults()) {
      String parameter = parameterName(result.getMethodParameter());
      if (result instanceof ParameterErrors body) {
        body.getFieldErrors().forEach(e -> errors.add(error(e.getField(), e)));
        body.getGlobalErrors().forEach(e -> errors.add(error(parameter, e)));
      } else {
        result.getResolvableErrors().forEach(e -> errors.add(error(parameter, e)));
      }
    }
    ex.getCrossParameterValidationResults().forEach(e -> errors.add(error("", e)));
    return withErrors(ex.getBody(), errors, ex, headers, status, request);
  }

  private ResponseEntity<Object> withErrors(ProblemDetail body, List<Map<String, String>> errors,
      Exception ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
    body.setProperty("errors", errors);              // serialized as a top-level "errors" member
    return handleExceptionInternal(ex, body, headers, status, request);
  }

  /** The request-facing name: @RequestParam("max-results") wins over the Java parameter name. */
  private static String parameterName(MethodParameter p) {
    RequestParam rp = p.getParameterAnnotation(RequestParam.class);
    if (rp != null && !rp.name().isEmpty()) return rp.name();
    PathVariable pv = p.getParameterAnnotation(PathVariable.class);
    if (pv != null && !pv.name().isEmpty()) return pv.name();
    return p.getParameterName();
  }

  private static Map<String, String> error(String field, MessageSourceResolvable e) {
    return Map.of("field", field, "message", String.valueOf(e.getDefaultMessage()));
  }
}
```

Notes:
- `FieldError.getField()` is the property path within the body: `legs[1].fare`, `origin.code`.
- For a body that is itself a list, each invalid element is its own `ParameterErrors` whose
  `getContainerIndex()` is the element index and whose field names are relative to the element
  (measured: index `1`, fields `name`, `qty`); prefix the index yourself (`"[" + index + "]." + field`).
- `getParameterName()` needs class files compiled with `-parameters`; `spring-boot-starter-parent`
  configures the compiler that way. Gradle's Boot plugin does too.
- `ex.visitResults(HandlerMethodValidationException.Visitor)` is the alternative: one callback per
  parameter kind (`requestParam`, `pathVariable`, `requestBody`, `requestHeader`, `modelAttribute`,
  ...), each with its annotation, which gives you the request-facing name directly.
- A property set with `ProblemDetail.setProperty("errors", ...)` is written as a top-level member
  next to `type`/`title`/`status`/`detail`/`instance` (measured with Jackson 3); no extra configuration.
- Malformed JSON and type mismatches are handled by the base class; you get problem details for them
  without writing anything.

## Constraint choices that come up in APIs

| Rule | Constraint |
| --- | --- |
| "positive, at most 2 decimals" for `BigDecimal` | `@NotNull @Positive @Digits(integer = 9, fraction = 2)` |
| "1 to 50 entries" | `@NotNull @Size(min = 1, max = 50)` (or `@NotEmpty @Size(max = 50)`) |
| validate each element | `List<@Valid Leg>` (type-use) on the record component |
| identifier format | `@Pattern(regexp = "[A-Z]{3}-\\d{4}")` (matches the whole value) |
| optional but bounded | `@Size(max = 40) String note` (null passes) |
| primitive `int` with a minimum | `@Min(1) int seats` (missing `int` is a 400 in Jackson 3 anyway) |

`@Pattern` and `@Size` accept `null`; add `@NotNull`/`@NotBlank` when the field is required.

## Messages

Default messages come from Hibernate Validator (`must be greater than or equal to 1`). Override per
constraint with `message = "..."` or in `ValidationMessages.properties`. Problem detail texts can be
customized through the `MessageSource` with codes `problemDetail.type.<exception FQCN>`,
`problemDetail.title.<exception FQCN>` and `problemDetail.<exception FQCN>`
(`ResponseEntityExceptionHandler` resolves them when a `MessageSource` is set, which Boot does).
