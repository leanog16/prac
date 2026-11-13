---
id: spring-testing
title: Testing Spring Boot apps
summary: The testing pyramid in Spring, plain unit tests with Mockito, @WebMvcTest slices with MockMvc and @MockitoBean, JSON assertions, testing security, @DataJpaTest, full @SpringBootTest integration tests, Testcontainers with @ServiceConnection, and keeping the suite fast.
minutes: 40
---
## Pick the smallest test that proves the point

`spring-boot-starter-test` bundles JUnit 5, AssertJ, Mockito, Hamcrest, JSONassert and Spring's test support. You can test at several levels:

| Test | Starts | Speed | Use for |
|---|---|---|---|
| plain JUnit + Mockito | nothing | milliseconds | business logic in services and domain classes |
| `@WebMvcTest` | the web layer only (controllers, advice, filters, Jackson) | fast | HTTP mapping, validation, status codes, JSON shape, security rules |
| `@DataJpaTest` | JPA, repositories, an embedded or container database | medium | custom queries, mappings, constraints |
| `@SpringBootTest` | the whole application context | slow | end-to-end wiring, critical flows |

Most tests should be unit and slice tests, with a few full integration tests on top.

## Unit tests: no Spring at all

Constructor injection pays off here: just call `new`.

```java
class PricingServiceTest {

    private final DiscountRepository discounts = mock(DiscountRepository.class);
    private final PricingService service = new PricingService(discounts);

    @Test
    void appliesTenPercentForGoldCustomers() {
        when(discounts.rateFor(Tier.GOLD)).thenReturn(new BigDecimal("0.10"));

        BigDecimal price = service.priceFor(new BigDecimal("200.00"), Tier.GOLD);

        assertThat(price).isEqualByComparingTo("180.00");
        verify(discounts).rateFor(Tier.GOLD);
    }
}
```

Structure tests as **arrange, act, assert** (given, when, then). AssertJ's `assertThat(...)` reads fluently and gives clear failure messages. Use `isEqualByComparingTo` for `BigDecimal`: `200.0` and `200.00` aren't `equals`.

## @WebMvcTest: the web layer

```java
@WebMvcTest(ProductController.class)
class ProductControllerTest {

    @Autowired MockMvc mvc;

    @MockitoBean ProductService products;          // replaces the real bean in the context

    @Test
    void returnsProduct() throws Exception {
        when(products.get(1L)).thenReturn(new ProductResponse(1L, "Lamp", new BigDecimal("19.99")));

        mvc.perform(get("/api/products/1"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.name").value("Lamp"))
           .andExpect(jsonPath("$.price").value(19.99));
    }

    @Test
    void rejectsBlankName() throws Exception {
        mvc.perform(post("/api/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name": "", "price": 5}
                    """))
           .andExpect(status().isBadRequest());
    }

    @Test
    void missingProductIs404() throws Exception {
        when(products.get(99L)).thenThrow(new ProductNotFoundException(99L));
        mvc.perform(get("/api/products/99")).andExpect(status().isNotFound());
    }
}
```

- `@WebMvcTest` loads controllers, `@RestControllerAdvice`, Jackson and security, but **not** services or repositories. Provide those as mocks.
- **`@MockitoBean`** (Spring Framework 6.2+) replaces a bean with a Mockito mock. Older code uses `@MockBean`, which is deprecated.
- `jsonPath("$.items[0].sku")` navigates the JSON response; `$.length()` gives an array's size.
- Text blocks (`"""`) make JSON request bodies readable.

## Testing security

With `spring-security-test`:

```java
@Test
@WithMockUser(roles = "ADMIN")
void adminCanDelete() throws Exception {
    mvc.perform(delete("/api/admin/users/5").with(csrf()))
       .andExpect(status().isNoContent());
}

@Test
void anonymousIsRejected() throws Exception {
    mvc.perform(get("/api/orders")).andExpect(status().isUnauthorized());
}

@Test
void jwtWithScope() throws Exception {
    mvc.perform(get("/api/orders").with(jwt().authorities(new SimpleGrantedAuthority("SCOPE_orders:read"))))
       .andExpect(status().isOk());
}
```

Test the **negative** cases (401, 403) as carefully as the positive ones. A security rule nobody tests is a rule nobody will notice breaking.

## @DataJpaTest: repositories

```java
@DataJpaTest
class ProductRepositoryTest {

    @Autowired ProductRepository repo;

    @Test
    void findsBySkuIgnoringOthers() {
        repo.save(new Product("Lamp", new BigDecimal("19.99"), "LMP-0001"));
        repo.save(new Product("Desk", new BigDecimal("149.00"), "DSK-0001"));

        assertThat(repo.findBySku("LMP-0001")).get()
                .extracting(Product::getName).isEqualTo("Lamp");
    }
}
```

Each test runs in a transaction that's **rolled back** afterwards, so tests don't leak data into each other. By default `@DataJpaTest` swaps in an embedded database (H2) if one is on the classpath. H2 isn't PostgreSQL, though: native queries, JSON columns and some constraints behave differently. For queries that matter, test against the real database engine.

## Testcontainers: the real database, disposable

**Testcontainers** starts real services in Docker for your tests. Boot 3.1+ wires them in with `@ServiceConnection`:

```java
@SpringBootTest
@Testcontainers
class OrderFlowIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired OrderService orders;

    @Test
    void placesAnOrder() {
        Order o = orders.place(new PlaceOrder("c-1", List.of(new Line("LMP-0001", 2))));
        assertThat(o.getStatus()).isEqualTo(Status.PLACED);
    }
}
```

`@ServiceConnection` sets `spring.datasource.url`, username and password from the container automatically. The same works for Redis, Kafka, RabbitMQ, MongoDB and others. Flyway migrations run against it at startup, so the test also proves your migrations work.

## Full application tests

`@SpringBootTest(webEnvironment = RANDOM_PORT)` starts the real server on a random port; call it with `TestRestTemplate` or `WebTestClient`:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiIT {
    @Autowired TestRestTemplate rest;

    @Test
    void healthIsUp() {
        ResponseEntity<String> r = rest.getForEntity("/actuator/health", String.class);
        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
```

## Keeping the suite fast

- Spring **caches application contexts** between test classes with identical configuration. Every distinct combination of `@MockitoBean`s, properties or profiles creates a new context, so standardize your test setups.
- Avoid `@DirtiesContext`: it throws the cached context away.
- Name integration tests `*IT` and run them with the Failsafe plugin (`./mvnw verify`), keeping `./mvnw test` quick.
- Use `@ActiveProfiles("test")` and an `application-test.properties` for test-specific settings.

:::quiz
q: What does `@WebMvcTest(ProductController.class)` load?
+ the MVC layer for that controller (plus advice, Jackson, filters), but not services or repositories
- the entire application context
- only the controller class, without Jackson
- the controller and its real service
why: It's a slice test. Supply dependencies with @MockitoBean.
:::

:::quiz
q: What happens to data saved in a `@DataJpaTest` test method?
- it persists for the next test
+ it's rolled back at the end of the test
- it's written to the production database
- it's saved to a file
why: Each @DataJpaTest test runs in a transaction that rolls back.
:::

:::quiz
q: Why use Testcontainers instead of H2 for repository tests?
- H2 can't run SQL
+ the tests run against the same database engine as production, so dialect-specific behavior is covered
- Testcontainers is faster
- H2 doesn't support transactions
why: Native SQL, types and constraints differ between H2 and PostgreSQL.
:::

:::quiz
q: Which annotation replaces a bean with a Mockito mock in a Spring test context in current Spring?
- @Mock
- @InjectMocks
+ @MockitoBean
- @Spy
why: @MockitoBean (Spring 6.2+) supersedes the deprecated @MockBean. Plain @Mock doesn't touch the Spring context.
:::

:::exercise
id: st-unit
level: 2
title: A Mockito unit test
mode: code
lang: java
file: GreetingServiceTest.java
---
Complete the test: stub `names.displayName("u1")` to return `"Ada"`, call `service.greet("u1")`, and assert with AssertJ that the result is `"Hello, Ada!"`.
---starter
package com.example.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;

class GreetingServiceTest {

    private final NameService names = mock(NameService.class);
    private final GreetingService service = new GreetingService(names);

    @Test
    void greetsByDisplayName() {
    }
}
---rule
when\(\s*names\.displayName\(\s*"u1"\s*\)\s*\)\.thenReturn\(\s*"Ada"\s*\)
Stub `displayName("u1")` → `"Ada"`
---rule
service\.greet\(\s*"u1"\s*\)
Call `service.greet("u1")`
---rule
assertThat\(\s*[\w.()"]+\s*\)\.isEqualTo\(\s*"Hello, Ada!"\s*\)
`assertThat(...).isEqualTo("Hello, Ada!")`
---solution
package com.example.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;

class GreetingServiceTest {

    private final NameService names = mock(NameService.class);
    private final GreetingService service = new GreetingService(names);

    @Test
    void greetsByDisplayName() {
        when(names.displayName("u1")).thenReturn("Ada");

        String result = service.greet("u1");

        assertThat(result).isEqualTo("Hello, Ada!");
    }
}
:::

:::exercise
id: st-webmvc
level: 3
title: A controller slice test
mode: code
lang: java
file: BookControllerTest.java
---
Make this a `@WebMvcTest` for `BookController`, with `BookService` replaced by a `@MockitoBean` field `books`. In the test, stub `books.get(7L)` to return `new BookResponse(7L, "Dune")`, perform `GET /api/books/7`, and expect status 200 and `$.title` equal to `"Dune"`.
---starter
package com.example.demo;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

class BookControllerTest {

    @Autowired
    MockMvc mvc;

    @Test
    void getsBook() throws Exception {
    }
}
---rule
@WebMvcTest\(\s*BookController\.class\s*\)\s*\n\s*class\s+BookControllerTest
`@WebMvcTest(BookController.class)`
---rule
@MockitoBean\s*\n?\s*BookService\s+books\s*;
`@MockitoBean BookService books;`
---rule
when\(\s*books\.get\(\s*7L\s*\)\s*\)\.thenReturn\(\s*new\s+BookResponse\(\s*7L\s*,\s*"Dune"\s*\)\s*\)
Stub `books.get(7L)`
---rule
mvc\.perform\(\s*get\(\s*"/api/books/7"\s*\)\s*\)
`mvc.perform(get("/api/books/7"))`
---rule
\.andExpect\(\s*status\(\s*\)\.isOk\(\s*\)\s*\)
Expect 200
---rule
\.andExpect\(\s*jsonPath\(\s*"\$\.title"\s*\)\.value\(\s*"Dune"\s*\)\s*\)
Expect `$.title` = `"Dune"`
---solution
package com.example.demo;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(BookController.class)
class BookControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    BookService books;

    @Test
    void getsBook() throws Exception {
        when(books.get(7L)).thenReturn(new BookResponse(7L, "Dune"));

        mvc.perform(get("/api/books/7"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.title").value("Dune"));
    }
}
:::

:::exercise
id: st-post-400
level: 3
title: Test validation
mode: code
lang: java
file: BookControllerTest.java
---
Add a test `rejectsBlankTitle` that POSTs `{"title": ""}` as JSON to `/api/books` and expects **400**.
---starter
package com.example.demo;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(BookController.class)
class BookControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    BookService books;
}
---rule
@Test\s*\n\s*void\s+rejectsBlankTitle\(\s*\)
`@Test void rejectsBlankTitle()`
---rule
post\(\s*"/api/books"\s*\)
POST to `/api/books`
---rule
\.contentType\(\s*MediaType\.APPLICATION_JSON\s*\)
JSON content type
---rule
\.content\([\s\S]*\\?"title\\?"\s*:\s*\\?"\\?"
Body `{"title": ""}`
---rule
\.andExpect\(\s*status\(\s*\)\.isBadRequest\(\s*\)\s*\)
Expect 400
---solution
package com.example.demo;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(BookController.class)
class BookControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    BookService books;

    @Test
    void rejectsBlankTitle() throws Exception {
        mvc.perform(post("/api/books")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\": \"\"}"))
           .andExpect(status().isBadRequest());
    }
}
:::

:::exercise
id: st-testcontainers
level: 3
title: A real PostgreSQL for tests
mode: code
lang: java
file: OrderRepositoryIT.java
---
Turn this into a Testcontainers test: annotate the class with `@Testcontainers`, and add a `static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")` annotated with both `@Container` and `@ServiceConnection`.
---starter
package com.example.demo;

import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class OrderRepositoryIT {
}
---rule
@Testcontainers
`@Testcontainers` on the class
---rule
@Container
`@Container`
---rule
@ServiceConnection
`@ServiceConnection`
---rule
static\s+PostgreSQLContainer<\?>\s+postgres\s*=\s*new\s+PostgreSQLContainer<>\(\s*"postgres:16-alpine"\s*\)
`static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")`
---solution
package com.example.demo;

import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class OrderRepositoryIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
}
:::

:::exercise
id: st-security-test
level: 3
title: Test the 403
mode: code
lang: java
file: AdminControllerTest.java
---
Write a test `userCannotDelete` that runs as a mock user with role `USER` (`@WithMockUser(roles = "USER")`), sends `DELETE /api/admin/users/5` with a CSRF token, and expects **403**.
---starter
package com.example.demo;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AdminController.class)
class AdminControllerTest {

    @Autowired
    MockMvc mvc;
}
---rule
@Test
`@Test`
---rule
@WithMockUser\(\s*roles\s*=\s*"USER"\s*\)
`@WithMockUser(roles = "USER")`
---rule
void\s+userCannotDelete\(\s*\)
`void userCannotDelete()`
---rule
delete\(\s*"/api/admin/users/5"\s*\)\.with\(\s*csrf\(\s*\)\s*\)
`delete("/api/admin/users/5").with(csrf())`
---rule
\.andExpect\(\s*status\(\s*\)\.isForbidden\(\s*\)\s*\)
Expect 403
---solution
package com.example.demo;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AdminController.class)
class AdminControllerTest {

    @Autowired
    MockMvc mvc;

    @Test
    @WithMockUser(roles = "USER")
    void userCannotDelete() throws Exception {
        mvc.perform(delete("/api/admin/users/5").with(csrf()))
           .andExpect(status().isForbidden());
    }
}
:::

:::exercise
id: st-run-tests
level: 1
title: Run the test suite
---
Run the tests of `~/spring-app` with the Maven wrapper and show only the line that reports how many tests ran.
---hint
`./mvnw test | grep 'Tests run'`
---solution
cd spring-app
./mvnw test | grep 'Tests run'
:::

:::exercise
id: st-failing
level: 2
title: A failing test fails the build
compare: verify
setup: cd spring-app && printf 'package com.example.demo;\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\nimport org.junit.jupiter.api.Test;\n\nclass MathTest {\n    @Test\n    void adds() {\n        assertEquals(1, 2);\n    }\n}\n' > src/test/java/com/example/demo/MathTest.java
---
Someone committed a broken test (`src/test/java/com/example/demo/MathTest.java` asserts `assertEquals(1, 2)`). Fix the assertion to `assertEquals(2, 1 + 1)` and run the build so that `./mvnw -q package` succeeds.
---hint
`sed -i 's/assertEquals(1, 2)/assertEquals(2, 1 + 1)/' spring-app/src/test/java/com/example/demo/MathTest.java`
---verify
cd spring-app && ./mvnw -q package && echo BUILD OK
ls target
---solution
sed -i 's/assertEquals(1, 2)/assertEquals(2, 1 + 1)/' spring-app/src/test/java/com/example/demo/MathTest.java
cd spring-app && ./mvnw -q package
:::
