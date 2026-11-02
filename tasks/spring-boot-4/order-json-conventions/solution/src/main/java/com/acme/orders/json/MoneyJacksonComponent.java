package com.acme.orders.json;

import com.acme.shared.money.Money;
import org.springframework.boot.jackson.JacksonComponent;
import tools.jackson.core.JsonGenerator;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.ValueSerializer;

/**
 * Wire format for {@link Money} (docs/json-guidelines.md, rule 3): {@code {"amount": "12.50",
 * "currency": "EUR"}} with the amount as a string at the currency's minor-unit scale. Money is
 * vendored, so the format lives here instead of in annotations on the class.
 */
@JacksonComponent
public class MoneyJacksonComponent {

  public static class Serializer extends ValueSerializer<Money> {
    @Override
    public void serialize(Money value, JsonGenerator gen, SerializationContext ctxt) {
      gen.writeStartObject();
      gen.writeStringProperty("amount", value.amount().toPlainString());
      gen.writeStringProperty("currency", value.currency().getCurrencyCode());
      gen.writeEndObject();
    }
  }

  public static class Deserializer extends ValueDeserializer<Money> {
    @Override
    public Money deserialize(JsonParser p, DeserializationContext ctxt) {
      JsonNode node = ctxt.readTree(p);
      JsonNode amount = node.get("amount");
      JsonNode currency = node.get("currency");
      if (amount == null || !amount.isString() || currency == null || !currency.isString()) {
        return ctxt.reportInputMismatch(
            Money.class, "money must be {\"amount\": \"<decimal>\", \"currency\": \"<ISO 4217>\"}");
      }
      try {
        return Money.of(amount.asString(), currency.asString());
      } catch (IllegalArgumentException e) {
        return ctxt.reportInputMismatch(Money.class, "invalid money: %s", e.getMessage());
      }
    }
  }
}
