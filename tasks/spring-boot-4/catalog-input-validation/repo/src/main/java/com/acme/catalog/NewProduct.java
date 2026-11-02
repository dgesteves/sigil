package com.acme.catalog;

import java.math.BigDecimal;

/** Body of POST /products. */
public record NewProduct(String sku, String name, String category, BigDecimal price) {}
