# catalog-api

Product catalog and store pricing API used by the shop front end and the store back-office tools.
Spring Boot 4.1 on Java 25, built with Maven.

## Commands

```sh
mvn -o test            # tests
mvn -o spring-boot:run # local server on :8080
```

The build is hermetic: `.mvn/maven.config` points Maven at the repo-local repository in `.m2/`,
which CI fills once. Builds run offline (`-o`); new dependencies have to be added to the mirror by
platform first.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/products?category=&page=&size=` | paged list, `page` is zero-based |
| GET | `/products/{sku}` | one product, 404 if unknown |
| POST | `/products` | create a product |
| POST | `/stores/{storeId}/price-changes` | apply a batch of store price overrides |

SKUs look like `MUG-0001` (three capital letters, a dash, four digits). Store ids look like
`ST-001`. Prices are in the store's currency with at most two decimals.
