package com.acme.orders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class OrderControllerTest {

  @Autowired MockMvc mvc;

  @Test
  void returnsAnOrder() throws Exception {
    mvc.perform(get("/orders/1001")).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(1001));
  }

  @Test
  void unknownOrderIsNotFound() throws Exception {
    mvc.perform(get("/orders/999")).andExpect(status().isNotFound());
  }

  @Test
  void listsOrders() throws Exception {
    mvc.perform(get("/orders"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(1001))
        .andExpect(jsonPath("$[1].id").value(1002));
  }
}
