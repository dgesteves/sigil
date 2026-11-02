package com.acme.orders;

import com.acme.shared.money.Money;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.List;

/** Body of POST /orders. */
public record NewOrder(
    @NotBlank String customerId, @NotEmpty List<@Valid Line> lines, String note, String couponCode) {

  public record Line(@NotBlank String productName, @Positive int quantity, @NotNull Money unitPrice) {}
}
