package com.acme.catalog;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class ProductControllerTest {

  @Autowired MockMvc mvc;

  @Test
  void listsTheFirstPage() throws Exception {
    mvc.perform(get("/products").param("category", "tea").param("size", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(1))
        .andExpect(jsonPath("$.items[0].sku").value("TEA-0100"))
        .andExpect(jsonPath("$.total").value(2));
  }

  @Test
  void getsOneProduct() throws Exception {
    mvc.perform(get("/products/MUG-0001"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("Stoneware mug"));
  }

  @Test
  void unknownProductIsNotFound() throws Exception {
    mvc.perform(get("/products/MUG-9999")).andExpect(status().isNotFound());
  }

  @Test
  void createsAProduct() throws Exception {
    mvc.perform(
            post("/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"sku":"CUP-0042","name":"Espresso cup","category":"kitchen","price":6.50}"""))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.sku").value("CUP-0042"));
  }

  @Test
  void appliesStorePriceChanges() throws Exception {
    mvc.perform(
            post("/stores/ST-001/price-changes")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"reason":"Spring promotion","changes":[
                      {"sku":"MUG-0001","newPrice":10.90},{"sku":"TEA-0100","newPrice":7.50}]}"""))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.applied").value(2));
  }
}
