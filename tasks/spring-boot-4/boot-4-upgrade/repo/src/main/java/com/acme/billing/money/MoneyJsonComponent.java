package com.acme.billing.money;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import java.io.IOException;
import org.springframework.boot.jackson.JsonComponent;

/** Money goes over the wire as a single string, {@code "12.50 EUR"}. */
@JsonComponent
public class MoneyJsonComponent {

  public static class Serializer extends JsonSerializer<Money> {
    @Override
    public void serialize(Money value, JsonGenerator gen, SerializerProvider serializers)
        throws IOException {
      gen.writeString(value.toString());
    }
  }

  public static class Deserializer extends JsonDeserializer<Money> {
    @Override
    public Money deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
      String text = p.getValueAsString();
      try {
        return Money.parse(text);
      } catch (IllegalArgumentException e) {
        throw ctxt.weirdStringException(text, Money.class, e.getMessage());
      }
    }
  }
}
