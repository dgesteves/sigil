package com.acme.catalog;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;

/** Body of POST /stores/{storeId}/price-changes. */
public record PriceChangeBatch(
    @NotBlank String reason, @NotNull @Size(min = 1, max = 50) List<@Valid Change> changes) {

  public record Change(
      @NotNull @Pattern(regexp = Skus.PATTERN) String sku,
      @NotNull @Positive @Digits(integer = 9, fraction = 2) BigDecimal newPrice) {}
}
