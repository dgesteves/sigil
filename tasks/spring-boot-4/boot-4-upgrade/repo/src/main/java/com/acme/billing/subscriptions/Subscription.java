package com.acme.billing.subscriptions;

import com.acme.billing.money.Money;
import java.time.Instant;

public record Subscription(
    String id,
    String customerId,
    String planCode,
    int seats,
    boolean trial,
    SubscriptionStatus status,
    Money monthlyPrice,
    Instant renewsAt,
    String cancelReason) {}
