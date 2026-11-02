package com.acme.billing.subscriptions;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/** Body of POST /subscriptions. Older partner integrations don't send {@code trial}. */
public record NewSubscription(
    @NotBlank String customerId, @NotBlank String planCode, @Min(1) int seats, boolean trial) {}
