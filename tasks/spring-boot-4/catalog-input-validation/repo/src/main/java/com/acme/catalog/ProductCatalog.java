package com.acme.catalog;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentSkipListMap;
import org.springframework.stereotype.Component;

/** In-memory catalog until the product service is split out. */
@Component
public class ProductCatalog {

  private final Map<String, Product> products = new ConcurrentSkipListMap<>();
  private final Map<String, Map<String, BigDecimal>> storePrices = new ConcurrentHashMap<>();

  public ProductCatalog() {
    add(new Product("MUG-0001", "Stoneware mug", "kitchen", new BigDecimal("12.90")));
    add(new Product("MUG-0002", "Travel mug", "kitchen", new BigDecimal("19.50")));
    add(new Product("TEA-0100", "Sencha, 100 g", "tea", new BigDecimal("8.40")));
    add(new Product("TEA-0101", "Genmaicha, 100 g", "tea", new BigDecimal("7.90")));
    add(new Product("POT-0010", "Cast iron teapot", "kitchen", new BigDecimal("54.00")));
  }

  public ProductPage page(String category, int page, int size) {
    List<Product> matching =
        products.values().stream()
            .filter(p -> category == null || p.category().equals(category))
            .toList();
    int from = Math.min(page * size, matching.size());
    int to = Math.min(from + size, matching.size());
    return new ProductPage(matching.subList(from, to), page, size, matching.size());
  }

  public Optional<Product> find(String sku) {
    return Optional.ofNullable(products.get(sku));
  }

  public Product add(Product product) {
    products.put(product.sku(), product);
    return product;
  }

  public int applyStorePrices(String storeId, PriceChangeBatch batch) {
    Map<String, BigDecimal> prices = storePrices.computeIfAbsent(storeId, id -> new ConcurrentHashMap<>());
    batch.changes().forEach(c -> prices.put(c.sku(), c.newPrice()));
    return batch.changes().size();
  }

  public Optional<BigDecimal> storePrice(String storeId, String sku) {
    return Optional.ofNullable(storePrices.getOrDefault(storeId, Map.of()).get(sku));
  }
}
