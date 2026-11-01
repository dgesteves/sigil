# orders-api

Order API behind the web shop and the mobile apps. Spring Boot 4.1 on Java 25, built with Maven.

## Commands

```sh
mvn -o test            # unit and web tests
mvn -o spring-boot:run # local server on :8080
```

The build is hermetic: `.mvn/maven.config` points Maven at the repo-local repository in `.m2/`,
which CI fills once. Builds run offline (`-o`); adding a dependency means asking platform to add it
to the mirror first.

## Layout

- `com.acme.orders`: controllers, request/response records and the in-memory order store.
- `com.acme.shared.money`: vendored copy of the platform money library. Do not edit it here;
  changes go to the platform repo.
- `docs/json-guidelines.md`: the JSON conventions every public API follows.
