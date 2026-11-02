package com.acme.billing.subscriptions;

import com.acme.billing.money.Money;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Service;

/** In-memory subscriptions until billing moves to the ledger service. */
@Service
public class SubscriptionService {

  private static final Map<String, Money> PLAN_PRICE_PER_SEAT =
      Map.of("starter", Money.of("12.50", "EUR"), "team", Money.of("9.00", "EUR"));

  private final Map<String, Subscription> subscriptions = new ConcurrentHashMap<>();
  private final AtomicInteger ids = new AtomicInteger(100);
  private final Clock clock = Clock.systemUTC();

  public SubscriptionService() {
    put(
        new Subscription(
            "sub-1",
            "c-1",
            "starter",
            1,
            false,
            SubscriptionStatus.ACTIVE,
            Money.of("12.50", "EUR"),
            Instant.parse("2026-12-01T00:00:00Z"),
            null));
    put(
        new Subscription(
            "sub-2",
            "c-2",
            "team",
            3,
            false,
            SubscriptionStatus.PAST_DUE,
            Money.of("27.00", "EUR"),
            Instant.parse("2026-11-15T00:00:00Z"),
            null));
  }

  public Optional<Subscription> find(String id) {
    return Optional.ofNullable(subscriptions.get(id));
  }

  public boolean knowsPlan(String planCode) {
    return PLAN_PRICE_PER_SEAT.containsKey(planCode);
  }

  public Subscription create(NewSubscription request) {
    Money perSeat = PLAN_PRICE_PER_SEAT.get(request.planCode());
    Instant renewsAt = clock.instant().plus(30, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
    return put(
        new Subscription(
            "sub-" + ids.incrementAndGet(),
            request.customerId(),
            request.planCode(),
            request.seats(),
            request.trial(),
            SubscriptionStatus.ACTIVE,
            perSeat.times(BigDecimal.valueOf(request.seats())),
            renewsAt,
            null));
  }

  public Optional<Subscription> changeStatus(String id, StatusChange change) {
    return find(id)
        .map(
            s ->
                put(
                    new Subscription(
                        s.id(),
                        s.customerId(),
                        s.planCode(),
                        s.seats(),
                        s.trial(),
                        change.status(),
                        s.monthlyPrice(),
                        s.renewsAt(),
                        change.status() == SubscriptionStatus.CANCELLED ? change.reason() : null)));
  }

  private Subscription put(Subscription subscription) {
    subscriptions.put(subscription.id(), subscription);
    return subscription;
  }
}
