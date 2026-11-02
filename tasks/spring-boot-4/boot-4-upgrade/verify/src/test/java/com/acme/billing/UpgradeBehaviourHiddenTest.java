package com.acme.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

import com.acme.billing.subscriptions.SubscriptionStatus;
import com.acme.billing.tax.TaxClient;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.json.BasicJsonParser;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Hidden verifier: the API behaves exactly as it did on Spring Boot 3.5. Written against APIs that
 * exist in both Boot 3.5 and 4.1 (plain HTTP, Boot's own JSON parser), and passes unchanged on the
 * original 3.5.16 build.
 */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class UpgradeBehaviourHiddenTest {

  @LocalServerPort int port;

  @MockitoBean TaxClient tax;

  private final HttpClient http = HttpClient.newHttpClient();

  private record Reply(int status, String body) {
    Map<String, Object> json() {
      return new BasicJsonParser().parseMap(body);
    }
  }

  private Reply send(String method, String path, String json) throws Exception {
    HttpRequest.Builder request =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Accept", "application/json");
    if (json == null) {
      request.method(method, HttpRequest.BodyPublishers.noBody());
    } else {
      request
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(json));
    }
    HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    return new Reply(response.statusCode(), response.body());
  }

  private String createSubscription() throws Exception {
    Reply created =
        send("POST", "/subscriptions", """
            {"customerId":"c-31","planCode":"starter","seats":1,"trial":false}""");
    assertThat(created.status()).as(created.body()).isEqualTo(201);
    return (String) created.json().get("id");
  }

  @Test
  void responsesUseEnumNamesStringMoneyAndIsoTimestamps() throws Exception {
    Reply active = send("GET", "/subscriptions/sub-1", null);
    assertThat(active.status()).isEqualTo(200);
    assertThat(active.json())
        .containsEntry("id", "sub-1")
        .containsEntry("status", "ACTIVE")
        .containsEntry("monthlyPrice", "12.50 EUR")
        .containsEntry("renewsAt", "2026-12-01T00:00:00Z")
        .doesNotContainKey("cancelReason");
    // BasicJsonParser keeps booleans and numbers loosely typed, so compare their JSON text.
    assertThat(active.json().get("trial")).hasToString("false");
    assertThat(active.json().get("seats")).hasToString("1");

    Reply pastDue = send("GET", "/subscriptions/sub-2", null);
    assertThat(pastDue.json()).containsEntry("status", "PAST_DUE");
  }

  @Test
  void olderClientsMayOmitTheTrialFlag() throws Exception {
    Reply created =
        send("POST", "/subscriptions", """
            {"customerId":"c-30","planCode":"team","seats":3}""");
    assertThat(created.status()).as(created.body()).isEqualTo(201);
    assertThat(created.json())
        .containsEntry("status", "ACTIVE")
        .containsEntry("monthlyPrice", "27.00 EUR");
    assertThat(created.json().get("trial")).hasToString("false");
  }

  @Test
  void unknownPropertiesAreStillRejected() throws Exception {
    Reply reply =
        send("POST", "/subscriptions", """
            {"customerId":"c-30","planCode":"team","seats":3,"discount":"50%"}""");
    assertThat(reply.status()).isEqualTo(400);
  }

  @Test
  void statusChangesAcceptEnumNames() throws Exception {
    String id = createSubscription();
    Reply changed =
        send("PATCH", "/subscriptions/" + id + "/status", """
            {"status":"CANCELLED","reason":"Moving to the annual plan"}""");
    assertThat(changed.status()).as(changed.body()).isEqualTo(200);
    assertThat(changed.json())
        .containsEntry("status", "CANCELLED")
        .containsEntry("cancelReason", "Moving to the annual plan");

    Reply reactivated =
        send("PATCH", "/subscriptions/" + id + "/status", """
            {"status":"PAST_DUE"}""");
    assertThat(reactivated.status()).as(reactivated.body()).isEqualTo(200);
    assertThat(reactivated.json()).containsEntry("status", "PAST_DUE").doesNotContainKey("cancelReason");
  }

  @Test
  void statusLabelsAreNotAcceptedAsValues() throws Exception {
    String id = createSubscription();
    Reply reply =
        send("PATCH", "/subscriptions/" + id + "/status", """
            {"status":"Cancelled"}""");
    assertThat(reply.status()).isEqualTo(400);
  }

  @Test
  void labelsStayAvailableForTheAdminUi() {
    assertThat(SubscriptionStatus.PAST_DUE.toString()).isEqualTo("Past due");
    assertThat(SubscriptionStatus.ACTIVE.name()).isEqualTo("ACTIVE");
  }

  @Test
  void quotesStillAddVat() throws Exception {
    given(tax.rateFor("PT")).willReturn(new BigDecimal("0.23"));
    Reply quote = send("GET", "/subscriptions/sub-1/quote?country=PT", null);
    assertThat(quote.status()).as(quote.body()).isEqualTo(200);
    assertThat(quote.json())
        .containsEntry("net", "12.50 EUR")
        .containsEntry("tax", "2.88 EUR")
        .containsEntry("gross", "15.38 EUR")
        .containsEntry("country", "PT");
  }

  @Test
  void unknownSubscriptionIsNotFound() throws Exception {
    assertThat(send("GET", "/subscriptions/sub-404", null).status()).isEqualTo(404);
  }
}
