package com.acme.orders;

import com.acme.shared.money.Money;

public record OrderLine(String productName, int quantity, Money unitPrice) {

  public Money lineTotal() {
    return unitPrice.times(quantity);
  }
}
