package com.acme.catalog;

import java.math.BigDecimal;

public record Product(String sku, String name, String category, BigDecimal price) {}
