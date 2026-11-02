package com.acme.shared.money;

import java.math.BigDecimal;
import java.util.Currency;
import java.util.Objects;

/**
 * An amount of money in one currency, always held at the currency's minor-unit scale
 * (EUR 2 digits, JPY 0, BHD 3).
 *
 * <p>Vendored from platform/money 3.2.0. Do not edit this copy; changes go to the platform repo.
 */
public final class Money implements Comparable<Money> {

  private final BigDecimal amount;
  private final Currency currency;

  private Money(BigDecimal amount, Currency currency) {
    this.amount = amount;
    this.currency = currency;
  }

  /**
   * @throws IllegalArgumentException if the currency has no minor unit (for example XXX) or the
   *     amount has more decimals than the currency allows
   */
  public static Money of(BigDecimal amount, Currency currency) {
    Objects.requireNonNull(amount, "amount");
    Objects.requireNonNull(currency, "currency");
    int digits = currency.getDefaultFractionDigits();
    if (digits < 0) {
      throw new IllegalArgumentException("currency has no minor unit: " + currency);
    }
    if (amount.stripTrailingZeros().scale() > digits) {
      throw new IllegalArgumentException(
          "too many decimals for " + currency + " (max " + digits + "): " + amount);
    }
    return new Money(amount.setScale(digits), currency);
  }

  /**
   * Parses a decimal amount and an ISO 4217 currency code.
   *
   * @throws IllegalArgumentException if either value is invalid
   */
  public static Money of(String amount, String currencyCode) {
    Objects.requireNonNull(amount, "amount");
    Objects.requireNonNull(currencyCode, "currencyCode");
    BigDecimal value;
    try {
      value = new BigDecimal(amount);
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("not a decimal amount: " + amount, e);
    }
    return of(value, Currency.getInstance(currencyCode));
  }

  public static Money zero(Currency currency) {
    return of(BigDecimal.ZERO, currency);
  }

  public BigDecimal amount() {
    return amount;
  }

  public Currency currency() {
    return currency;
  }

  public Money plus(Money other) {
    requireSameCurrency(other);
    return new Money(amount.add(other.amount), currency);
  }

  public Money times(int factor) {
    return new Money(amount.multiply(BigDecimal.valueOf(factor)), currency);
  }

  private void requireSameCurrency(Money other) {
    if (!currency.equals(other.currency)) {
      throw new IllegalArgumentException("currency mismatch: " + currency + " vs " + other.currency);
    }
  }

  @Override
  public int compareTo(Money other) {
    requireSameCurrency(other);
    return amount.compareTo(other.amount);
  }

  @Override
  public boolean equals(Object o) {
    return o instanceof Money m && amount.equals(m.amount) && currency.equals(m.currency);
  }

  @Override
  public int hashCode() {
    return Objects.hash(amount, currency);
  }

  /** For logs only, for example {@code 12.50 EUR}. Not a wire format. */
  @Override
  public String toString() {
    return amount.toPlainString() + " " + currency.getCurrencyCode();
  }
}
