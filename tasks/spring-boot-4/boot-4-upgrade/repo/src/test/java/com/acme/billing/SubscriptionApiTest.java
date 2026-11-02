package com.acme.billing;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.billing.tax.TaxClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** The JSON contract from the README, through the full application context. */
@SpringBootTest
@AutoConfigureMockMvc
class SubscriptionApiTest {

  @Autowired MockMvc mvc;

  @MockBean TaxClient tax;

  @Test
  void subscriptionJsonFollowsTheContract() throws Exception {
    mvc.perform(get("/subscriptions/sub-1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ACTIVE"))
        .andExpect(jsonPath("$.monthlyPrice").value("12.50 EUR"))
        .andExpect(jsonPath("$.renewsAt").value("2026-12-01T00:00:00Z"))
        .andExpect(jsonPath("$.cancelReason").doesNotExist());
  }

  @Test
  void createsASubscription() throws Exception {
    mvc.perform(
            post("/subscriptions")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"customerId":"c-7","planCode":"team","seats":2,"trial":true}"""))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.monthlyPrice").value("18.00 EUR"))
        .andExpect(jsonPath("$.trial").value(true));
  }

  @Test
  void rejectsUnknownProperties() throws Exception {
    mvc.perform(
            post("/subscriptions")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"customerId":"c-7","planCode":"team","seats":2,"coupon":"X"}"""))
        .andExpect(status().isBadRequest());
  }
}
