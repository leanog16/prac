---
id: spring-config
title: Configuration, profiles & operations
summary: application.properties vs YAML, @Value and its pitfalls, type-safe @ConfigurationProperties records with validation, profiles and profile-specific files, secrets from the environment, logging levels, Actuator probes and metrics, caching with @Cacheable, scheduled jobs and outbound HTTP with RestClient.
minutes: 40
---
> [!project] Bookshelf, step 7: settings, not constants
> The loan period (14 days) and the fine per overdue day are hard-coded. The library wants to change them without a release, and run H2 locally but PostgreSQL in production. Typed properties and profiles do both.

## properties or YAML

Both live in `src/main/resources`; pick one style per project.

```properties title=application.properties
spring.application.name=shop
server.port=8080
shop.orders.max-items=50
shop.orders.currency=EUR
```

```yaml title=application.yml
spring:
  application:
    name: shop
server:
  port: 8080
shop:
  orders:
    max-items: 50
    currency: EUR
```

Values can reference other values and environment variables, with defaults: `spring.datasource.password=${DB_PASSWORD}` fails at startup if `DB_PASSWORD` is unset; `${DB_PASSWORD:devpass}` falls back to `devpass`.

## @Value for one-off values

```java
@Service
public class PricingService {
    private final int maxItems;

    public PricingService(@Value("${shop.orders.max-items:20}") int maxItems) {
        this.maxItems = maxItems;
    }
}
```

`@Value` is fine for one or two values. It has drawbacks at scale: property names are strings scattered through the code, typos only fail at runtime (or silently use the default), and there's no validation.

## @ConfigurationProperties: typed configuration

Group related settings into a record:

```java
@Validated
@ConfigurationProperties(prefix = "shop.orders")
public record OrderProperties(
        @Min(1) int maxItems,
        @NotBlank String currency,
        Duration paymentTimeout
) {}
```

```java
@SpringBootApplication
@ConfigurationPropertiesScan          // or @EnableConfigurationProperties(OrderProperties.class)
public class ShopApplication { ... }
```

Inject `OrderProperties` like any bean. Spring binds `shop.orders.max-items` to `maxItems` (kebab-case in files, camelCase in Java), converts types (`30s` → `Duration`, `10MB` → `DataSize`), and with `@Validated` refuses to start on invalid values. Fail fast at boot, not at 3 a.m. on the first order.

## Profiles

A **profile** is a named set of configuration for an environment: `dev`, `test`, `prod`. Spring loads `application.properties` first, then `application-{profile}.properties` for each active profile, which overrides matching keys:

```
src/main/resources/
├── application.properties          shared defaults
├── application-dev.properties      H2, verbose logging
└── application-prod.properties     PostgreSQL, JSON logs, strict settings
```

Activate profiles with `SPRING_PROFILES_ACTIVE=prod`, `--spring.profiles.active=prod`, or in tests with `@ActiveProfiles("test")`.

Beans can be profile-specific too:

```java
@Configuration
@Profile("dev")
public class DevDataLoader {
    @Bean
    CommandLineRunner seed(ProductRepository repo) {
        return args -> repo.save(new Product("Demo", new BigDecimal("9.99"), "DEM-0001"));
    }
}
```

`@Profile("!prod")` means "any profile except prod".

> [!warn] Secrets don't go in property files
> Commit `application-prod.properties` with **placeholders** (`${DB_PASSWORD}`), never real secrets. Supply them through environment variables, Kubernetes secrets, or a secret manager (AWS Secrets Manager, Vault) via Spring Cloud integrations.

## Logging

Boot uses SLF4J with Logback. Log through a logger, never `System.out`:

```java
private static final Logger log = LoggerFactory.getLogger(OrderService.class);

log.info("Order {} placed by customer {}", order.getId(), customerId);   // placeholders, not string +
log.warn("Payment retry {} for order {}", attempt, orderId);
log.error("Payment failed for order {}", orderId, exception);           // exception last: full stack trace
```

Set levels per package:

```properties
logging.level.root=INFO
logging.level.com.example.shop=DEBUG
logging.level.org.hibernate.SQL=DEBUG
logging.structured.format.console=ecs     # Boot 3.4+: JSON logs for log platforms
```

Levels can be changed at runtime through the Actuator `loggers` endpoint, without a restart.

## Actuator in production

```properties
management.endpoints.web.exposure.include=health,info,prometheus
management.endpoint.health.probes.enabled=true
management.endpoint.health.show-details=when-authorized
```

- `/actuator/health/liveness` and `/actuator/health/readiness` map directly to Kubernetes probes.
- `/actuator/prometheus` (with `micrometer-registry-prometheus`) exposes JVM, HTTP, datasource-pool and custom metrics.
- Record your own metrics with an injected `MeterRegistry`: `registry.counter("orders.placed").increment()`.
- Consider serving Actuator on a separate port (`management.server.port=8081`) that isn't exposed publicly.

## Caching

```java
@SpringBootApplication
@EnableCaching
public class ShopApplication { ... }

@Service
public class CatalogService {
    @Cacheable("products")
    public ProductResponse get(long id) { ... }        // first call runs; later calls with the same id hit the cache

    @CacheEvict(value = "products", key = "#id")
    public void update(long id, UpdateProduct cmd) { ... }
}
```

Without configuration the cache is an in-memory map per instance. For several instances or expiry, use Caffeine (`spring.cache.caffeine.spec=maximumSize=1000,expireAfterWrite=10m`) or Redis. Like `@Transactional`, caching works through proxies, so self-invocation bypasses it.

## Scheduled jobs

```java
@EnableScheduling        // on a @Configuration class

@Component
public class CleanupJob {
    @Scheduled(cron = "0 0 3 * * *")          // every day at 03:00 (sec min hour day month weekday)
    public void purgeExpiredCarts() { ... }

    @Scheduled(fixedDelayString = "PT5M")      // 5 minutes after the previous run finished
    public void syncInventory() { ... }
}
```

With several instances, every instance runs the job. Use a lock (ShedLock) or a dedicated worker when it must run once.

## Calling other services: RestClient

`RestClient` (Spring 6.1+) is the modern synchronous HTTP client:

```java
@Bean
RestClient inventoryClient(RestClient.Builder builder, @Value("${inventory.url}") String url) {
    return builder.baseUrl(url).build();
}

StockLevel level = inventoryClient.get()
        .uri("/stock/{sku}", sku)
        .retrieve()
        .body(StockLevel.class);
```

Configure timeouts on the underlying request factory, and wrap flaky calls with retries and circuit breakers (Spring Retry, Resilience4j).

## Worked example: replacing constants with configuration

```java
@Validated
@ConfigurationProperties(prefix = "bookshelf.loans")
public record LoanProperties(
        @Min(1) @Max(90) int days,
        @Min(1) int maxPerMember,
        @NotNull BigDecimal finePerDay
) {}
```

```yaml title=application.yml
bookshelf:
  loans:
    days: 14
    max-per-member: 5
    fine-per-day: 0.25
```

```yaml title=application-dev.yml
spring:
  datasource:
    url: jdbc:h2:mem:bookshelf
  jpa:
    hibernate:
      ddl-auto: create-drop
logging:
  level:
    org.library.bookshelf: DEBUG
```

```yaml title=application-prod.yml
spring:
  datasource:
    url: ${DATABASE_URL}
    username: ${DATABASE_USER}
    password: ${DATABASE_PASSWORD}
  jpa:
    hibernate:
      ddl-auto: validate
```

`StandardLoanPolicy` from step 2 now reads `LoanProperties` instead of returning `14`. The summer reading program becomes `BOOKSHELF_LOANS_DAYS=28` in the environment, with no code change, no release. And if someone sets `days: 0`, the app **refuses to start** and names the bad property, instead of creating loans due today.

> [!plain] In plain English
> Code says **what** to do; configuration says **with which values**. Values that differ between environments or change over time belong in configuration.

## Common mistakes

> [!mistake] Profile-specific secrets in Git
> `application-prod.yml` should reference `${DATABASE_PASSWORD}`, never contain it.

:::quiz
q: `application.properties` has `server.port=8080`, `application-prod.properties` has `server.port=80`, and the prod profile is active. Which port?
- 8080
+ 80
- both
- startup fails
why: Profile-specific files override the defaults for keys they define.
:::

:::quiz
q: Why prefer `@ConfigurationProperties` over many `@Value` annotations?
+ type-safe grouping, relaxed binding, validation at startup, and one place for related settings
- @Value is deprecated
- @ConfigurationProperties is faster at runtime
- @Value can't read environment variables
why: Typed, validated configuration fails fast and is easy to find and test.
:::

:::quiz
q: Which is the correct way to log with SLF4J?
- `log.info("Order " + id + " placed")`
+ `log.info("Order {} placed", id)`
- `System.out.println("Order placed")`
- `log.info(String.format("Order %s", id))`
why: Placeholders defer string building until the level is enabled, and keep log messages consistent.
:::

:::quiz
q: `@Cacheable("products")` is on `get(id)`. Another method in the same class calls `this.get(5)`. Is the cache used?
- yes
+ no: self-invocation bypasses the proxy
- only the second time
- only with Redis
why: Same proxy rule as @Transactional.
:::

:::exercise
id: sc-props-record
level: 3
title: Typed configuration
mode: code
lang: java
file: MailProperties.java
---
Create a validated `@ConfigurationProperties` record `MailProperties` bound to the prefix `app.mail`, with components `@NotBlank String host`, `@Min(1) @Max(65535) int port` and `@NotBlank String from`.
---starter
package com.example.demo;

import jakarta.validation.constraints.*;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
---rule
@Validated
`@Validated`
---rule
@ConfigurationProperties\(\s*(prefix\s*=\s*)?"app\.mail"\s*\)
`@ConfigurationProperties(prefix = "app.mail")`
---rule
public\s+record\s+MailProperties\(
`public record MailProperties(...)`
---rule
@NotBlank\s+String\s+host
`@NotBlank String host`
---rule
@Min\(\s*1\s*\)\s+@Max\(\s*65535\s*\)\s+int\s+port|@Max\(\s*65535\s*\)\s+@Min\(\s*1\s*\)\s+int\s+port
`@Min(1) @Max(65535) int port`
---rule
@NotBlank\s+String\s+from
`@NotBlank String from`
---solution
package com.example.demo;

import jakarta.validation.constraints.*;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app.mail")
public record MailProperties(
        @NotBlank String host,
        @Min(1) @Max(65535) int port,
        @NotBlank String from
) {}
:::

:::exercise
id: sc-yaml
level: 2
title: Write the YAML
mode: code
lang: yaml
file: application.yml
---
Write `application.yml` setting `app.mail.host` to `smtp.example.com`, `app.mail.port` to `587`, `app.mail.from` to `noreply@example.com`, and `server.port` to `9000`, using nested YAML keys (not dotted ones).
---starter
# app configuration
---rule
^app:\s*\n\s+mail:\s*\n
`app:` → `mail:`
---rule
^\s+host:\s*smtp\.example\.com\s*$
`host: smtp.example.com`
---rule
^\s+port:\s*587\s*$
`port: 587`
---rule
^\s+from:\s*["']?noreply@example\.com["']?\s*$
`from: noreply@example.com`
---rule
^server:\s*\n\s+port:\s*9000\s*$
`server:` → `port: 9000`
---solution
app:
  mail:
    host: smtp.example.com
    port: 587
    from: noreply@example.com
server:
  port: 9000
:::

:::exercise
id: sc-value-default
level: 2
title: A value with a default
mode: code
lang: java
file: RetryService.java
---
Inject the property `app.retry.max-attempts` into a constructor parameter `int maxAttempts`, defaulting to **3** when it's not set, and store it in a `private final int maxAttempts` field.
---starter
package com.example.demo;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class RetryService {
}
---rule
private\s+final\s+int\s+maxAttempts\s*;
`private final int maxAttempts;`
---rule
public\s+RetryService\(\s*@Value\(\s*"\$\{app\.retry\.max-attempts:3\}"\s*\)\s+int\s+maxAttempts\s*\)
`@Value("${app.retry.max-attempts:3}") int maxAttempts`
---rule
this\.maxAttempts\s*=\s*maxAttempts\s*;
Assign it
---solution
package com.example.demo;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class RetryService {

    private final int maxAttempts;

    public RetryService(@Value("${app.retry.max-attempts:3}") int maxAttempts) {
        this.maxAttempts = maxAttempts;
    }
}
:::

:::exercise
id: sc-profile-bean
level: 2
title: A dev-only bean
mode: code
lang: java
file: FakeMailConfig.java
---
Make `FakeMailConfig` a configuration class that's only active when the profile is **not** `prod`, defining a `@Bean` `MailSender mailSender()` that returns `new LoggingMailSender()`.
---starter
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

public class FakeMailConfig {
}
---rule
@Configuration
`@Configuration`
---rule
@Profile\(\s*"!prod"\s*\)
`@Profile("!prod")`
---rule
@Bean\s*\n\s*(public\s+)?MailSender\s+mailSender\(\s*\)\s*\{\s*return\s+new\s+LoggingMailSender\(\s*\)\s*;
`@Bean MailSender mailSender()` returning `new LoggingMailSender()`
---solution
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("!prod")
public class FakeMailConfig {

    @Bean
    public MailSender mailSender() {
        return new LoggingMailSender();
    }
}
:::

:::exercise
id: sc-run-profile
level: 2
title: Run with a profile
---
Build `~/spring-app` quietly and start the jar (output discarded) with the **prod** profile active via an environment variable, then print `GET /api/status`.
---solution
cd spring-app
./mvnw -q package
SPRING_PROFILES_ACTIVE=prod java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null
curl -s localhost:8080/api/status
:::

:::exercise
id: sc-logging
level: 2
title: Log levels
mode: code
lang: properties
file: application.properties
---
Set the root log level to `WARN`, the level for `com.example.demo` to `DEBUG`, and expose the actuator endpoints `health`, `info` and `prometheus` over HTTP.
---starter
spring.application.name=demo
---rule
^logging\.level\.root\s*=\s*WARN\s*$
`logging.level.root=WARN`
---rule
^logging\.level\.com\.example\.demo\s*=\s*DEBUG\s*$
`logging.level.com.example.demo=DEBUG`
---rule
^management\.endpoints\.web\.exposure\.include\s*=\s*(health,info,prometheus|health,prometheus,info|info,health,prometheus|info,prometheus,health|prometheus,health,info|prometheus,info,health)\s*$
`management.endpoints.web.exposure.include=health,info,prometheus`
---solution
spring.application.name=demo
logging.level.root=WARN
logging.level.com.example.demo=DEBUG
management.endpoints.web.exposure.include=health,info,prometheus
:::

:::exercise
id: sc-cacheable
level: 3
title: Cache and evict
mode: code
lang: java
file: CatalogService.java
---
Cache `get(long id)` in the cache `"products"`, and make `update(long id, String name)` evict that id's entry from the same cache using `key = "#id"`.
---starter
package com.example.demo;

import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

@Service
public class CatalogService {

    public Product get(long id) {
        return load(id);
    }

    public void update(long id, String name) {
        save(id, name);
    }
}
---rule
@Cacheable\(\s*(value\s*=\s*|cacheNames\s*=\s*)?"products"\s*\)\s*\n\s*public\s+Product\s+get
`@Cacheable("products")` on `get`
---rule
@CacheEvict\((?=[^)]*"products")(?=[^)]*key\s*=\s*"#id")[^)]*\)\s*\n\s*public\s+void\s+update
`@CacheEvict(value = "products", key = "#id")` on `update`
---solution
package com.example.demo;

import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

@Service
public class CatalogService {

    @Cacheable("products")
    public Product get(long id) {
        return load(id);
    }

    @CacheEvict(value = "products", key = "#id")
    public void update(long id, String name) {
        save(id, name);
    }
}
:::

:::exercise
id: sc-scheduled
level: 2
title: A nightly job
mode: code
lang: java
file: ReportJob.java
---
Schedule `sendDailyReport()` to run **every day at 06:30** with a cron expression (Spring's six-field format: second minute hour day month weekday).
---starter
package com.example.demo;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ReportJob {

    public void sendDailyReport() {
    }
}
---rule
@Scheduled\(\s*cron\s*=\s*"0\s+30\s+6\s+\*\s+\*\s+\*"\s*\)
`@Scheduled(cron = "0 30 6 * * *")`
---solution
package com.example.demo;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ReportJob {

    @Scheduled(cron = "0 30 6 * * *")
    public void sendDailyReport() {
    }
}
:::

:::exercise
id: sc-env-name
level: 1
title: Property to environment variable
mode: answer
---
What environment variable sets the property `app.mail.from`?
---answer
APP_MAIL_FROM
---solution
APP_MAIL_FROM
:::

:::exercise
id: proj-sp-07-props
level: 3
title: "Project 7: LoanProperties"
mode: code
lang: java
file: LoanProperties.java
---
Write a validated `@ConfigurationProperties` record `LoanProperties` with prefix `bookshelf.loans` and components `@Min(1) @Max(90) int days`, `@Min(1) int maxPerMember` and `@NotNull BigDecimal finePerDay`.
---starter
package org.library.bookshelf;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
---rule
@Validated
`@Validated`
---rule
@ConfigurationProperties\(\s*(prefix\s*=\s*)?"bookshelf\.loans"\s*\)
Prefix `bookshelf.loans`
---rule
public\s+record\s+LoanProperties\(
A record
---rule
@Min\(\s*1\s*\)\s+@Max\(\s*90\s*\)\s+int\s+days
`days` 1–90
---rule
@Min\(\s*1\s*\)\s+int\s+maxPerMember
`maxPerMember` ≥ 1
---rule
@NotNull\s+BigDecimal\s+finePerDay
`finePerDay` required
---solution
package org.library.bookshelf;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "bookshelf.loans")
public record LoanProperties(
        @Min(1) @Max(90) int days,
        @Min(1) int maxPerMember,
        @NotNull BigDecimal finePerDay
) {}
:::

:::exercise
id: proj-sp-07-prod-yaml
level: 2
title: "Project 7b: the production profile"
mode: code
lang: yaml
file: application-prod.yml
---
Write `application-prod.yml`: datasource `url`, `username` and `password` from the environment variables `DATABASE_URL`, `DATABASE_USER` and `DATABASE_PASSWORD` (`${...}` placeholders), and Hibernate `ddl-auto: validate`.
---starter
# production profile
---rule
^spring:\s*\n\s+datasource:
`spring.datasource`
---rule
url:\s*\$\{DATABASE_URL\}
`url: ${DATABASE_URL}`
---rule
username:\s*\$\{DATABASE_USER\}
`username: ${DATABASE_USER}`
---rule
password:\s*\$\{DATABASE_PASSWORD\}
`password: ${DATABASE_PASSWORD}`
---rule
jpa:\s*\n\s+hibernate:\s*\n\s+ddl-auto:\s*validate
`jpa.hibernate.ddl-auto: validate`
---solution
spring:
  datasource:
    url: ${DATABASE_URL}
    username: ${DATABASE_USER}
    password: ${DATABASE_PASSWORD}
  jpa:
    hibernate:
      ddl-auto: validate
:::

:::exercise
id: proj-sp-07-env
level: 2
title: "Project 7c: summer reading"
mode: answer
---
For the summer reading program, the library wants `bookshelf.loans.days` set to 28 in production **without** changing any file. Write the environment variable assignment (e.g. `NAME=value`).
---answer
BOOKSHELF_LOANS_DAYS=28
---solution
BOOKSHELF_LOANS_DAYS=28
:::
