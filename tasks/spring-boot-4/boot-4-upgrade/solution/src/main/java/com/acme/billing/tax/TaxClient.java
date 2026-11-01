package com.acme.billing.tax;

import java.math.BigDecimal;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/** Client for the internal tax service: VAT rate per country. */
@Component
public class TaxClient {

  record TaxRate(String country, BigDecimal rate) {}

  private final RestTemplate rest;

  public TaxClient(RestTemplateBuilder builder, TaxProperties properties) {
    this.rest =
        builder
            .rootUri(properties.baseUrl().toString())
            .connectTimeout(properties.connectTimeout())
            .readTimeout(properties.readTimeout())
            .build();
  }

  /** VAT rate as a fraction, for example 0.23 for Portugal. */
  public BigDecimal rateFor(String country) {
    TaxRate rate = rest.getForObject("/rates/{country}", TaxRate.class, country);
    if (rate == null) {
      throw new IllegalStateException("tax service returned no rate for " + country);
    }
    return rate.rate();
  }
}
