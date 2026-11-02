package com.acme.billing;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.billing.subscriptions.SubscriptionController;
import com.acme.billing.subscriptions.SubscriptionService;
import com.acme.billing.tax.TaxClient;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(SubscriptionController.class)
class SubscriptionControllerTest {

  @Autowired MockMvc mvc;

  @MockBean SubscriptionService subscriptions;

  @MockBean TaxClient tax;

  @Test
  void invalidRequestNeverReachesTheService() throws Exception {
    mvc.perform(
            post("/subscriptions")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"customerId":" ","planCode":"team","seats":0}"""))
        .andExpect(status().isBadRequest());
    verify(subscriptions, never()).create(any());
  }

  @Test
  void unknownSubscriptionIsNotFound() throws Exception {
    given(subscriptions.find("sub-404")).willReturn(Optional.empty());
    mvc.perform(get("/subscriptions/sub-404")).andExpect(status().isNotFound());
  }
}
