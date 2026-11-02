package com.acme.orders;

import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/orders")
public class OrderController {

  private final OrderStore store;

  public OrderController(OrderStore store) {
    this.store = store;
  }

  @GetMapping
  public List<Order> list() {
    return store.all();
  }

  @GetMapping("/{id}")
  public Order get(@PathVariable long id) {
    return store
        .find(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no order " + id));
  }

  @PostMapping
  public ResponseEntity<Order> create(@Valid @RequestBody NewOrder request) {
    long currencies =
        request.lines().stream().map(l -> l.unitPrice().currency()).distinct().count();
    if (currencies > 1) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "all lines of an order must use one currency");
    }
    Order order = store.create(request);
    return ResponseEntity.created(URI.create("/orders/" + order.id())).body(order);
  }
}
