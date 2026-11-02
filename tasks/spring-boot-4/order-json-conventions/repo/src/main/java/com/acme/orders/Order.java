package com.acme.orders;

import com.acme.shared.money.Money;
import java.time.Instant;
import java.util.List;

public record Order(
    long id,
    String customerId,
    Instant createdAt,
    OrderStatus status,
    List<OrderLine> lines,
    Money total,
    String note,
    String couponCode) {}
