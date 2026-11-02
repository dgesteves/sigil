package com.acme.billing.subscriptions;

public enum SubscriptionStatus {
  ACTIVE("Active"),
  PAST_DUE("Past due"),
  CANCELLED("Cancelled");

  private final String label;

  SubscriptionStatus(String label) {
    this.label = label;
  }

  /** Human-readable label for the admin UI and for log lines. The API uses the enum name. */
  @Override
  public String toString() {
    return label;
  }
}
