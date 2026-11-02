package com.acme.billing.config;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.cfg.DateTimeFeature;
import tools.jackson.databind.cfg.EnumFeature;

/** The JSON contract from the README: no nulls, ISO timestamps, unknown properties rejected. */
@Configuration
public class JacksonConfig {

  @Bean
  JsonMapperBuilderCustomizer apiContract() {
    return builder ->
        builder
            .changeDefaultPropertyInclusion(
                inclusion -> inclusion.withValueInclusion(JsonInclude.Include.NON_NULL))
            .disable(DateTimeFeature.WRITE_DATES_AS_TIMESTAMPS)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            // Jackson 3 changed these defaults. Keep the Jackson 2 wire behaviour the contract
            // promises: enums by name (SubscriptionStatus overrides toString for the admin UI),
            // and omitted or null primitives (older clients don't send "trial") read as 0/false.
            .disable(EnumFeature.WRITE_ENUMS_USING_TO_STRING)
            .disable(EnumFeature.READ_ENUMS_USING_TO_STRING)
            .disable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);
  }
}
