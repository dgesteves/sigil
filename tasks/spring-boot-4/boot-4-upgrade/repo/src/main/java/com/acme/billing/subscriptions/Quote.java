package com.acme.billing.subscriptions;

import com.acme.billing.money.Money;

public record Quote(String subscriptionId, String country, Money net, Money tax, Money gross) {}
