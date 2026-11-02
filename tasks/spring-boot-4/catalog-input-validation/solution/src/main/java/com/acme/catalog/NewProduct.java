package com.acme.catalog;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/** Body of POST /products. */
public record NewProduct(
    @NotNull @Pattern(regexp = Skus.PATTERN) String sku,
    @NotBlank @Size(max = 80) String name,
    @NotBlank String category,
    @NotNull @Positive @Digits(integer = 9, fraction = 2) BigDecimal price) {}
