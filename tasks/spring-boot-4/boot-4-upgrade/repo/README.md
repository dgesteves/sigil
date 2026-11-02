# billing-api

Subscriptions and price quotes for the self-service portal and the partner API. Spring Boot on
Java 25, built with Maven.

## Commands

```sh
mvn -o test            # tests
mvn -o spring-boot:run # local server on :8080 (needs the tax service, see tax.base-url)
```

The build is hermetic: `.mvn/maven.config` points Maven at the repo-local repository in `.m2/`,
which CI fills from the platform mirror. Builds run offline (`-o`). The mirror carries the Spring
Boot starters (and their test starters) for the Boot version in the parent POM; anything else has
to be added by platform first.

## API contract

Partner integrations are generated from our published examples, so the JSON is a contract:

- money is a string, `"12.50 EUR"`;
- timestamps are ISO 8601 UTC strings;
- null properties are left out;
- statuses are the enum names (`ACTIVE`, `PAST_DUE`, `CANCELLED`);
- requests with properties we don't know are rejected with 400, so typos don't go unnoticed.
