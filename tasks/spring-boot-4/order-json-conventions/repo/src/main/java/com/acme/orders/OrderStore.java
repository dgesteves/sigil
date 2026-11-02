package com.acme.orders;

import com.acme.shared.money.Money;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/** In-memory store until the orders database lands. Seeded with two orders for the demo apps. */
@Component
public class OrderStore {

  private final Map<Long, Order> orders = new ConcurrentSkipListMap<>();
  private final AtomicLong ids = new AtomicLong(2000);
  private final Clock clock;

  public OrderStore() {
    this(Clock.systemUTC());
  }

  OrderStore(Clock clock) {
    this.clock = clock;
    List<OrderLine> eur =
        List.of(
            new OrderLine("Espresso cup", 2, Money.of("3.75", "EUR")),
            new OrderLine("Gift card", 1, Money.of("5", "EUR")));
    save(
        new Order(
            1001,
            "c-17",
            Instant.parse("2026-03-01T10:15:30Z"),
            OrderStatus.PAID,
            eur,
            total(eur),
            null,
            null));
    List<OrderLine> jpy = List.of(new OrderLine("Matcha whisk", 3, Money.of("400", "JPY")));
    save(
        new Order(
            1002,
            "c-42",
            Instant.parse("2026-03-02T08:00:00Z"),
            OrderStatus.SHIPPED,
            jpy,
            total(jpy),
            "Leave at the door",
            "WELCOME10"));
  }

  public List<Order> all() {
    return List.copyOf(orders.values());
  }

  public Optional<Order> find(long id) {
    return Optional.ofNullable(orders.get(id));
  }

  public Order create(NewOrder request) {
    List<OrderLine> lines =
        request.lines().stream()
            .map(l -> new OrderLine(l.productName(), l.quantity(), l.unitPrice()))
            .toList();
    Order order =
        new Order(
            ids.incrementAndGet(),
            request.customerId(),
            clock.instant(),
            OrderStatus.PLACED,
            lines,
            total(lines),
            request.note(),
            request.couponCode());
    return save(order);
  }

  private Order save(Order order) {
    orders.put(order.id(), order);
    return order;
  }

  /** @throws IllegalArgumentException if the lines use more than one currency */
  static Money total(List<OrderLine> lines) {
    Money sum = Money.zero(lines.getFirst().unitPrice().currency());
    for (OrderLine line : lines) {
      sum = sum.plus(line.lineTotal());
    }
    return sum;
  }
}
