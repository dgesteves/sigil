package com.acme.catalog;

final class Skus {
  /** Three capital letters, a dash, four digits: MUG-0001. */
  static final String PATTERN = "[A-Z]{3}-\\d{4}";

  /** ST-001. */
  static final String STORE_ID = "ST-\\d{3}";

  private Skus() {}
}
