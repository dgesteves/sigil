package com.acme.orders;

import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** Hidden verifier: docs/json-guidelines.md, checked through the real MVC stack. */
@SpringBootTest
@AutoConfigureMockMvc
class JsonGuidelinesHiddenTest {

  private static final String UTC_TIMESTAMP = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z";

  @Autowired MockMvc mvc;

  private ResultActions postOrder(String json) throws Exception {
    return mvc.perform(post("/orders").contentType(MediaType.APPLICATION_JSON).content(json));
  }

  private static String line(String amount, String currency) {
    return """
        {"customer_id":"c-9","lines":[{"product_name":"Mug","quantity":2,
         "unit_price":{"amount":"%s","currency":"%s"}}]}"""
        .formatted(amount, currency);
  }

  @Test
  void responsePropertiesAreSnakeCase() throws Exception {
    mvc.perform(get("/orders/1001"))
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(jsonPath("$.id").value(1001))
        .andExpect(jsonPath("$.customer_id").value("c-17"))
        .andExpect(jsonPath("$.status").value("PAID"))
        .andExpect(jsonPath("$.lines[0].product_name").value("Espresso cup"))
        .andExpect(jsonPath("$.lines[0].quantity").value(2))
        .andExpect(jsonPath("$.customerId").doesNotExist())
        .andExpect(jsonPath("$.createdAt").doesNotExist())
        .andExpect(jsonPath("$.lines[0].productName").doesNotExist())
        .andExpect(jsonPath("$.lines[0].unitPrice").doesNotExist());
  }

  @Test
  void nullPropertiesAreOmitted() throws Exception {
    mvc.perform(get("/orders/1001"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.note").doesNotExist())
        .andExpect(jsonPath("$.coupon_code").doesNotExist())
        .andExpect(jsonPath("$.couponCode").doesNotExist());
    mvc.perform(get("/orders/1002"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.note").value("Leave at the door"))
        .andExpect(jsonPath("$.coupon_code").value("WELCOME10"));
    mvc.perform(get("/orders"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].note").doesNotExist())
        .andExpect(jsonPath("$[1].coupon_code").value("WELCOME10"));
  }

  @Test
  void moneyIsAnObjectWithAStringAmountAtTheCurrencyScale() throws Exception {
    mvc.perform(get("/orders/1001"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.total.amount").value("12.50"))
        .andExpect(jsonPath("$.total.currency").value("EUR"))
        .andExpect(jsonPath("$.lines[0].unit_price.amount").value("3.75"))
        .andExpect(jsonPath("$.lines[1].unit_price.amount").value("5.00"))
        .andExpect(jsonPath("$.lines[1].unit_price.currency").value("EUR"));
    mvc.perform(get("/orders/1002"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.total.amount").value("1200"))
        .andExpect(jsonPath("$.total.currency").value("JPY"))
        .andExpect(jsonPath("$.lines[0].unit_price.amount").value("400"));
  }

  @Test
  void timestampsAreUtcIsoStrings() throws Exception {
    mvc.perform(get("/orders/1001"))
        .andExpect(jsonPath("$.created_at").value("2026-03-01T10:15:30Z"));
  }

  @Test
  void requestBodiesUseTheSameConventions() throws Exception {
    postOrder(line("7.50", "EUR"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.customer_id").value("c-9"))
        .andExpect(jsonPath("$.status").value("PLACED"))
        .andExpect(jsonPath("$.lines[0].unit_price.amount").value("7.50"))
        .andExpect(jsonPath("$.total.amount").value("15.00"))
        .andExpect(jsonPath("$.total.currency").value("EUR"))
        .andExpect(jsonPath("$.created_at").value(matchesPattern(UTC_TIMESTAMP)))
        .andExpect(jsonPath("$.note").doesNotExist());
    postOrder(line("1200", "JPY"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.total.amount").value("2400"))
        .andExpect(jsonPath("$.total.currency").value("JPY"));
    postOrder(
            """
            {"customer_id":"c-10","note":"Ring twice","coupon_code":"SPRING",
             "lines":[{"product_name":"Tea","quantity":1,"unit_price":{"amount":"0.250","currency":"BHD"}}]}""")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.note").value("Ring twice"))
        .andExpect(jsonPath("$.coupon_code").value("SPRING"))
        .andExpect(jsonPath("$.total.amount").value("0.250"));
  }

  @Test
  void camelCaseRequestPropertiesAreNotAccepted() throws Exception {
    postOrder(
            """
            {"customerId":"c-9","lines":[{"productName":"Mug","quantity":2,
             "unitPrice":{"amount":"7.50","currency":"EUR"}}]}""")
        .andExpect(status().isBadRequest());
  }

  @Test
  void invalidMoneyInRequestsIsRejectedWith400() throws Exception {
    postOrder(line("7.505", "EUR")).andExpect(status().isBadRequest());
    postOrder(line("12.5", "JPY")).andExpect(status().isBadRequest());
    postOrder(line("7.50", "EURO")).andExpect(status().isBadRequest());
    postOrder(line("seven", "EUR")).andExpect(status().isBadRequest());
    postOrder(line("7.50", "XXX")).andExpect(status().isBadRequest());
  }

  @Test
  void unknownOrderStillNotFound() throws Exception {
    mvc.perform(get("/orders/4242")).andExpect(status().isNotFound());
  }
}
