package com.acme.billing.subscriptions;

import com.acme.billing.money.Money;
import com.acme.billing.tax.TaxClient;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/subscriptions")
public class SubscriptionController {

  private final SubscriptionService subscriptions;
  private final TaxClient tax;

  public SubscriptionController(SubscriptionService subscriptions, TaxClient tax) {
    this.subscriptions = subscriptions;
    this.tax = tax;
  }

  @GetMapping("/{id}")
  public Subscription get(@PathVariable String id) {
    return subscriptions.find(id).orElseThrow(() -> notFound(id));
  }

  @PostMapping
  public ResponseEntity<Subscription> create(@Valid @RequestBody NewSubscription request) {
    if (!subscriptions.knowsPlan(request.planCode())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown plan " + request.planCode());
    }
    Subscription created = subscriptions.create(request);
    return ResponseEntity.created(URI.create("/subscriptions/" + created.id())).body(created);
  }

  @PatchMapping("/{id}/status")
  public Subscription changeStatus(
      @PathVariable String id, @Valid @RequestBody StatusChange change) {
    return subscriptions.changeStatus(id, change).orElseThrow(() -> notFound(id));
  }

  @GetMapping("/{id}/quote")
  public Quote quote(@PathVariable String id, @RequestParam String country) {
    Subscription subscription = get(id);
    BigDecimal rate = tax.rateFor(country);
    Money net = subscription.monthlyPrice();
    Money vat = net.times(rate);
    return new Quote(id, country, net, vat, net.plus(vat));
  }

  private static ResponseStatusException notFound(String id) {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "no subscription " + id);
  }
}
