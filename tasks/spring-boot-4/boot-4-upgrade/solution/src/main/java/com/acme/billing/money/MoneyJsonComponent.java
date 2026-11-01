package com.acme.billing.money;

import org.springframework.boot.jackson.JacksonComponent;
import tools.jackson.core.JsonGenerator;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.ValueSerializer;

/** Money goes over the wire as a single string, {@code "12.50 EUR"}. */
@JacksonComponent
public class MoneyJsonComponent {

  public static class Serializer extends ValueSerializer<Money> {
    @Override
    public void serialize(Money value, JsonGenerator gen, SerializationContext ctxt) {
      gen.writeString(value.toString());
    }
  }

  public static class Deserializer extends ValueDeserializer<Money> {
    @Override
    public Money deserialize(JsonParser p, DeserializationContext ctxt) {
      String text = p.getValueAsString();
      try {
        return Money.parse(text);
      } catch (IllegalArgumentException e) {
        throw ctxt.weirdStringException(text, Money.class, e.getMessage());
      }
    }
  }
}
