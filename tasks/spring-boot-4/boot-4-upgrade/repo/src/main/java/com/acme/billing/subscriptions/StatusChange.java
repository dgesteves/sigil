package com.acme.billing.subscriptions;

import jakarta.validation.constraints.NotNull;

/** Body of PATCH /subscriptions/{id}/status. */
public record StatusChange(@NotNull SubscriptionStatus status, String reason) {}
