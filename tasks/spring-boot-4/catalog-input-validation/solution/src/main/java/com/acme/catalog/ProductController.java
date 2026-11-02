package com.acme.catalog;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import java.net.URI;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

// No class-level @Validated: Spring MVC validates the constrained parameters itself and reports
// parameter and body violations together in one HandlerMethodValidationException.
@RestController
public class ProductController {

  private final ProductCatalog catalog;

  public ProductController(ProductCatalog catalog) {
    this.catalog = catalog;
  }

  @GetMapping("/products")
  public ProductPage list(
      @RequestParam(required = false) String category,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
    return catalog.page(category, page, size);
  }

  @GetMapping("/products/{sku}")
  public Product get(@PathVariable @Pattern(regexp = Skus.PATTERN) String sku) {
    return catalog
        .find(sku)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no product " + sku));
  }

  @PostMapping("/products")
  public ResponseEntity<Product> create(@Valid @RequestBody NewProduct body) {
    Product product = catalog.add(new Product(body.sku(), body.name(), body.category(), body.price()));
    return ResponseEntity.created(URI.create("/products/" + product.sku())).body(product);
  }

  @PostMapping("/stores/{storeId}/price-changes")
  public ResponseEntity<Map<String, Object>> changePrices(
      @PathVariable @Pattern(regexp = Skus.STORE_ID) String storeId,
      @Valid @RequestBody PriceChangeBatch batch) {
    int applied = catalog.applyStorePrices(storeId, batch);
    return ResponseEntity.accepted().body(Map.of("storeId", storeId, "applied", applied));
  }
}
