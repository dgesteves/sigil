package com.acme.catalog;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.emptyOrNullString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;

/** Hidden verifier: the validation rules and the error format from the request. */
@SpringBootTest
@AutoConfigureMockMvc
class InputValidationHiddenTest {

  @Autowired MockMvc mvc;

  private static final String BAD_BATCH =
      """
      {"reason":"","changes":[{"sku":"MUG-0001","newPrice":4.50},{"sku":"mug-1","newPrice":0}]}""";

  private static final String GOOD_BATCH =
      """
      {"reason":"Clearance","changes":[{"sku":"MUG-0001","newPrice":4.50}]}""";

  private ResultActions problem(RequestBuilder request) throws Exception {
    return mvc.perform(request)
        .andExpect(status().isBadRequest())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.status").value(400));
  }

  private ResultActions violations(RequestBuilder request, String... fields) throws Exception {
    return problem(request)
        .andExpect(jsonPath("$.errors[*].field", hasItems(fields)))
        .andExpect(jsonPath("$.errors[*].message", everyItem(not(emptyOrNullString()))));
  }

  private static RequestBuilder postJson(String path, String json) {
    return post(path).contentType(MediaType.APPLICATION_JSON).content(json);
  }

  @Test
  void pagingParametersAreValidated() throws Exception {
    violations(get("/products").param("size", "0"), "size");
    violations(get("/products").param("size", "101"), "size");
    violations(get("/products").param("page", "-1"), "page")
        .andExpect(jsonPath("$.errors[*].field", not(hasItem("size"))));
    violations(get("/products").param("page", "-1").param("size", "0"), "page", "size");
  }

  @Test
  void validPagingStillWorks() throws Exception {
    mvc.perform(get("/products")).andExpect(status().isOk()).andExpect(jsonPath("$.size").value(20));
    mvc.perform(get("/products").param("size", "100").param("page", "0"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.total").value(5));
  }

  @Test
  void nonNumericParameterIsAProblem() throws Exception {
    problem(get("/products").param("size", "abc"));
  }

  @Test
  void skuPathVariableIsValidated() throws Exception {
    violations(get("/products/mug-1"), "sku");
    violations(get("/products/MUG-00001"), "sku");
    mvc.perform(get("/products/MUG-9999")).andExpect(status().isNotFound());
    mvc.perform(get("/products/MUG-0002")).andExpect(status().isOk());
  }

  @Test
  void createReportsEveryInvalidField() throws Exception {
    violations(
            postJson("/products", """
                {"sku":"bad","name":"","category":"kitchen","price":-1}"""),
            "sku", "name", "price")
        .andExpect(jsonPath("$.errors[*].field", not(hasItem("category"))));
    violations(
            postJson(
                "/products",
                """
                {"sku":"CUP-0001","name":"%s","price":1.999}""".formatted("x".repeat(81))),
            "name", "category", "price")
        .andExpect(jsonPath("$.errors[*].field", not(hasItem("sku"))));
    violations(postJson("/products", """
        {"sku":"CUP-0001","name":"Cup","category":"kitchen"}"""), "price");
  }

  @Test
  void validCreateStillWorks() throws Exception {
    mvc.perform(
            postJson("/products", """
                {"sku":"CUP-0007","name":"Cup","category":"kitchen","price":3.25}"""))
        .andExpect(status().isCreated());
  }

  @Test
  void priceChangeBodyIsValidatedPerEntry() throws Exception {
    violations(postJson("/stores/ST-001/price-changes", BAD_BATCH),
            "reason", "changes[1].sku", "changes[1].newPrice")
        .andExpect(jsonPath("$.errors[*].field", not(hasItem("changes[0].sku"))))
        .andExpect(jsonPath("$.errors[*].field", not(hasItem("changes[0].newPrice"))))
        .andExpect(jsonPath("$.errors[*].field", not(hasItem("storeId"))));
    violations(postJson("/stores/ST-001/price-changes", """
        {"reason":"x","changes":[{"sku":"MUG-0001","newPrice":4.555}]}"""), "changes[0].newPrice");
  }

  @Test
  void priceChangeBatchSizeIsValidated() throws Exception {
    violations(postJson("/stores/ST-001/price-changes", """
        {"reason":"x","changes":[]}"""), "changes");
    violations(postJson("/stores/ST-001/price-changes", """
        {"reason":"x"}"""), "changes");
    String fiftyOne =
        IntStream.range(0, 51)
            .mapToObj(i -> "{\"sku\":\"MUG-0001\",\"newPrice\":1.00}")
            .collect(Collectors.joining(","));
    violations(postJson("/stores/ST-001/price-changes",
        "{\"reason\":\"x\",\"changes\":[" + fiftyOne + "]}"), "changes");
  }

  @Test
  void invalidStoreIdIsReported() throws Exception {
    violations(postJson("/stores/store-1/price-changes", GOOD_BATCH), "storeId");
  }

  @Test
  void parameterAndBodyViolationsAreReportedTogether() throws Exception {
    violations(postJson("/stores/store-1/price-changes", BAD_BATCH),
        "storeId", "reason", "changes[1].sku", "changes[1].newPrice");
  }

  @Test
  void malformedJsonIsAProblem() throws Exception {
    problem(postJson("/stores/ST-001/price-changes", "{\"reason\":"));
    problem(postJson("/products", "[1,2"));
  }

  @Test
  void validPriceChangesStillApply() throws Exception {
    mvc.perform(postJson("/stores/ST-002/price-changes", GOOD_BATCH))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.applied").value(1));
  }
}
