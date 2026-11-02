package com.acme.catalog;

import java.math.BigDecimal;
import java.util.List;

/** Body of POST /stores/{storeId}/price-changes. */
public record PriceChangeBatch(String reason, List<Change> changes) {

  public record Change(String sku, BigDecimal newPrice) {}
}
