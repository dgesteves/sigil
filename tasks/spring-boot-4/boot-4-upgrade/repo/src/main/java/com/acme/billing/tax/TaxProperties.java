package com.acme.billing.tax;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("tax")
public record TaxProperties(
    URI baseUrl,
    @DefaultValue("2s") Duration connectTimeout,
    @DefaultValue("5s") Duration readTimeout) {}
