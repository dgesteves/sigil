package com.acme.billing;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.billing.tax.TaxClient;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Hidden verifier: the real TaxClient still reaches the tax service at tax.base-url. */
@SpringBootTest(webEnvironment = WebEnvironment.NONE)
class TaxClientHiddenTest {

  static final List<String> paths = new CopyOnWriteArrayList<>();
  static final HttpServer taxService = start();

  static HttpServer start() {
    try {
      HttpServer server =
          HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
      server.createContext(
          "/rates/",
          exchange -> {
            paths.add(exchange.getRequestURI().getPath());
            String country = exchange.getRequestURI().getPath().substring("/rates/".length());
            String rate = country.equals("PT") ? "0.23" : "0.19";
            byte[] body =
                ("{\"country\":\"" + country + "\",\"rate\":" + rate + "}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
          });
      server.start();
      return server;
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @DynamicPropertySource
  static void taxServiceUrl(DynamicPropertyRegistry registry) {
    registry.add(
        "tax.base-url", () -> "http://127.0.0.1:" + taxService.getAddress().getPort());
  }

  @AfterAll
  static void stop() {
    taxService.stop(0);
  }

  @Autowired TaxClient client;

  @Test
  void fetchesTheRateFromTheConfiguredTaxService() {
    assertThat(client.rateFor("PT")).isEqualByComparingTo(new BigDecimal("0.23"));
    assertThat(client.rateFor("DE")).isEqualByComparingTo(new BigDecimal("0.19"));
    assertThat(paths).containsExactly("/rates/PT", "/rates/DE");
  }
}
