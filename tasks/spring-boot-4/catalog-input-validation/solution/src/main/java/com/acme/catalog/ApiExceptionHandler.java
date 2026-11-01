package com.acme.catalog;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.springframework.context.MessageSourceResolvable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Every Spring MVC exception becomes an RFC 9457 problem (ResponseEntityExceptionHandler), and both
 * validation exceptions get an {@code errors} array:
 *
 * <ul>
 *   <li>MethodArgumentNotValidException: a {@code @Valid @RequestBody} on a method without other
 *       constrained parameters.
 *   <li>HandlerMethodValidationException: a method with constrained parameters
 *       ({@code @PathVariable @Pattern ...}); the body's errors are reported in the same exception.
 * </ul>
 */
@RestControllerAdvice
class ApiExceptionHandler extends ResponseEntityExceptionHandler {

  @Override
  protected @Nullable ResponseEntity<Object> handleMethodArgumentNotValid(
      MethodArgumentNotValidException ex,
      HttpHeaders headers,
      HttpStatusCode status,
      WebRequest request) {
    List<Map<String, String>> errors = new ArrayList<>();
    ex.getBindingResult().getFieldErrors().forEach(e -> errors.add(fieldError(e)));
    ex.getBindingResult().getGlobalErrors().forEach(e -> errors.add(error(e.getObjectName(), e)));
    return withErrors(ex.getBody(), errors, ex, headers, status, request);
  }

  @Override
  protected @Nullable ResponseEntity<Object> handleHandlerMethodValidationException(
      HandlerMethodValidationException ex,
      HttpHeaders headers,
      HttpStatusCode status,
      WebRequest request) {
    List<Map<String, String>> errors = new ArrayList<>();
    for (var result : ex.getParameterValidationResults()) {
      String parameter = result.getMethodParameter().getParameterName();
      if (result instanceof org.springframework.validation.method.ParameterErrors bodyErrors) {
        bodyErrors.getFieldErrors().forEach(e -> errors.add(fieldError(e)));
        bodyErrors.getGlobalErrors().forEach(e -> errors.add(error(parameter, e)));
      } else {
        result.getResolvableErrors().forEach(e -> errors.add(error(parameter, e)));
      }
    }
    return withErrors(ex.getBody(), errors, ex, headers, status, request);
  }

  private @Nullable ResponseEntity<Object> withErrors(
      ProblemDetail body,
      List<Map<String, String>> errors,
      Exception ex,
      HttpHeaders headers,
      HttpStatusCode status,
      WebRequest request) {
    body.setProperty("errors", errors);
    return handleExceptionInternal(ex, body, headers, status, request);
  }

  private static Map<String, String> fieldError(FieldError e) {
    return error(e.getField(), e);
  }

  private static Map<String, String> error(String field, MessageSourceResolvable e) {
    return Map.of("field", field, "message", String.valueOf(e.getDefaultMessage()));
  }
}
