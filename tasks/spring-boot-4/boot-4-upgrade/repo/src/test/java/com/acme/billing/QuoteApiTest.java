package com.acme.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

import com.acme.billing.tax.TaxClient;
import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** Over real HTTP, the way the portal calls it. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class QuoteApiTest {

  @Autowired TestRestTemplate http;

  @MockBean TaxClient tax;

  @Test
  void quoteAddsVat() {
    given(tax.rateFor("PT")).willReturn(new BigDecimal("0.23"));

    ResponseEntity<Map> response =
        http.getForEntity("/subscriptions/sub-1/quote?country=PT", Map.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody())
        .containsEntry("net", "12.50 EUR")
        .containsEntry("tax", "2.88 EUR")
        .containsEntry("gross", "15.38 EUR");
  }
}
