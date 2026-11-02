package com.acme.billing;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringBootVersion;
import org.springframework.util.ClassUtils;

/** Hidden verifier: the upgrade really is to Boot 4.1.2, without the Jackson 2 or classic escape hatches. */
class StaysOnBoot4HiddenTest {

  private static boolean present(String className) {
    return ClassUtils.isPresent(className, StaysOnBoot4HiddenTest.class.getClassLoader());
  }

  @Test
  void runsOnSpringBoot412() {
    assertThat(SpringBootVersion.getVersion()).isEqualTo("4.1.2");
  }

  @Test
  void usesJackson3NotTheDeprecatedJackson2Support() {
    assertThat(present("tools.jackson.databind.json.JsonMapper")).isTrue();
    assertThat(present("com.fasterxml.jackson.databind.ObjectMapper")).isFalse();
    assertThat(present("org.springframework.boot.jackson2.autoconfigure.Jackson2AutoConfiguration"))
        .isFalse();
  }

  @Test
  void doesNotUseTheClassicStarters() throws Exception {
    String pom = Files.readString(Path.of("pom.xml"));
    assertThat(pom).doesNotContain("spring-boot-starter-classic", "spring-boot-starter-test-classic");
  }
}
