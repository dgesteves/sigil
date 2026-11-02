package com.acme.billing.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;
import java.util.Objects;

/** An amount in one currency, kept at the currency's minor-unit scale (rounded half up). */
public record Money(BigDecimal amount, Currency currency) {

  public Money {
    Objects.requireNonNull(amount, "amount");
    Objects.requireNonNull(currency, "currency");
    amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_UP);
  }

  public static Money of(String amount, String currencyCode) {
    return new Money(new BigDecimal(amount), Currency.getInstance(currencyCode));
  }

  /** Parses the wire format, for example {@code "12.50 EUR"}. */
  public static Money parse(String text) {
    String[] parts = text == null ? new String[0] : text.trim().split(" ");
    if (parts.length != 2) {
      throw new IllegalArgumentException("expected '<amount> <currency>', got: " + text);
    }
    return of(parts[0], parts[1]);
  }

  public Money plus(Money other) {
    if (!currency.equals(other.currency)) {
      throw new IllegalArgumentException("currency mismatch: " + currency + " vs " + other.currency);
    }
    return new Money(amount.add(other.amount), currency);
  }

  public Money times(BigDecimal factor) {
    return new Money(amount.multiply(factor), currency);
  }

  /** The wire format: {@code "12.50 EUR"}. */
  @Override
  public String toString() {
    return amount.toPlainString() + " " + currency.getCurrencyCode();
  }
}
