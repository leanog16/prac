---
id: spring-jpa
title: Spring Data JPA
summary: Entities and IDs, the JpaRepository interface, derived query methods, @Query with JPQL and native SQL, pagination and sorting with Pageable, projections, datasource configuration, ddl-auto vs Flyway migrations, and the service layer.
minutes: 40
---
> [!project] Bookshelf, step 5: the catalog in a database
> Books move from an in-memory list into PostgreSQL. This step maps the `Book` entity, writes `BookRepository` with the searches the catalog page needs, and implements `BookService` on top of it.

## The stack

- **JPA** (Jakarta Persistence) is the standard Java API for mapping objects to relational tables.
- **Hibernate** is the JPA implementation Spring Boot uses.
- **Spring Data JPA** generates repository implementations from interfaces, so you rarely write data-access code by hand.

Add `spring-boot-starter-data-jpa` plus a JDBC driver (`org.postgresql:postgresql`, `com.h2database:h2` for tests), then configure the connection:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/shop
spring.datasource.username=shop
spring.datasource.password=${DB_PASSWORD}
spring.jpa.hibernate.ddl-auto=validate
spring.jpa.open-in-view=false
```

## Entities

```java
import jakarta.persistence.*;

@Entity
@Table(name = "products")
public class Product {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal price;

    @Column(unique = true, nullable = false)
    private String sku;

    @Enumerated(EnumType.STRING)
    private Status status = Status.ACTIVE;

    private Instant createdAt = Instant.now();

    protected Product() {}                          // JPA needs a no-args constructor

    public Product(String name, BigDecimal price, String sku) { ... }

    // getters (and setters only where mutation makes sense)
}
```

- `@Entity` marks the class as mapped; `@Table` names the table (default: the class name).
- `@Id` + `@GeneratedValue(strategy = IDENTITY)` uses the database's auto-increment / identity column.
- Use **wrapper types** (`Long`, not `long`) for IDs, so a new, unsaved entity has `id == null`.
- `@Enumerated(EnumType.STRING)` stores `"ACTIVE"`. The default, `ORDINAL`, stores `0`, `1`, … and silently corrupts data when someone reorders the enum.
- Entities are classes, not records: JPA needs a no-args constructor and mutable state to track changes.

## Repositories

```java
public interface ProductRepository extends JpaRepository<Product, Long> {
}
```

That's it. Spring generates a bean with `save`, `saveAll`, `findById` (returns `Optional`), `findAll`, `existsById`, `count`, `deleteById`, `findAll(Pageable)`, `findAll(Sort)` and more.

## Derived query methods

Name a method following the convention and Spring writes the query:

```java
public interface ProductRepository extends JpaRepository<Product, Long> {
    Optional<Product> findBySku(String sku);
    List<Product> findByStatus(Status status);
    List<Product> findByNameContainingIgnoreCase(String fragment);
    List<Product> findByPriceBetween(BigDecimal min, BigDecimal max);
    List<Product> findByStatusOrderByPriceDesc(Status status);
    List<Product> findTop5ByOrderByCreatedAtDesc();
    boolean existsBySku(String sku);
    long countByStatus(Status status);
    void deleteByStatus(Status status);
}
```

Keywords: `And`, `Or`, `Between`, `LessThan`, `GreaterThanEqual`, `IsNull`, `IsNotNull`, `Like`, `Containing`, `StartingWith`, `In`, `Not`, `True`/`False`, `IgnoreCase`, `OrderBy…Asc/Desc`, `First`/`Top<n>`, `Distinct`. A typo in a property name fails at **startup**, which is nice.

## @Query for anything else

When a name would be absurd, write **JPQL** (queries over entities and fields, not tables and columns):

```java
@Query("select p from Product p where p.price < :max and p.status = 'ACTIVE' order by p.price")
List<Product> cheapActive(@Param("max") BigDecimal max);

@Query(value = "select * from products where sku ilike :pattern", nativeQuery = true)
List<Product> searchSku(@Param("pattern") String pattern);

@Modifying
@Query("update Product p set p.status = :status where p.id in :ids")
int updateStatus(@Param("status") Status status, @Param("ids") List<Long> ids);
```

`@Modifying` is required for update/delete queries, and they must run in a transaction.

> [!warn] Never concatenate user input into queries
> Always use parameters (`:name`). Building JPQL or SQL with `+` opens you to injection, exactly as with raw SQL.

## Pagination and sorting

```java
Page<Product> findByStatus(Status status, Pageable pageable);
```

```java
@GetMapping("/api/products")
public Page<ProductResponse> list(@RequestParam(defaultValue = "0") int page,
                                  @RequestParam(defaultValue = "20") int size) {
    Pageable pageable = PageRequest.of(page, size, Sort.by("price").descending());
    return repo.findByStatus(Status.ACTIVE, pageable).map(ProductResponse::from);
}
```

A `Page` carries the content plus `totalElements`, `totalPages` and `number`, at the cost of an extra `count` query. A `Slice` skips the count and only knows if there's a next page. Pages are **zero-based**. Controllers can also take a `Pageable` parameter directly; Spring builds it from `?page=0&size=20&sort=price,desc`.

## Projections

Fetch only the columns you need with an interface or record projection:

```java
public record ProductSummary(Long id, String name) {}

List<ProductSummary> findByStatus(Status status);       // selects only id and name
```

## Schema management: ddl-auto vs migrations

`spring.jpa.hibernate.ddl-auto` controls whether Hibernate touches the schema:

| Value | Does | Use |
|---|---|---|
| `create-drop` | creates tables at startup, drops at shutdown | tests, demos |
| `update` | alters tables to match entities, never drops | quick prototypes only |
| `validate` | checks entities match the schema, fails startup if not | **production** |
| `none` | nothing | production |

In production, manage the schema with versioned migrations: **Flyway** or **Liquibase**. Add `flyway-core` (plus `flyway-database-postgresql`), put SQL files in `src/main/resources/db/migration`, and Boot runs pending ones at startup:

```sql title=V1__create_products.sql
CREATE TABLE products (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    price      NUMERIC(10, 2) NOT NULL,
    sku        VARCHAR(20) NOT NULL UNIQUE,
    status     VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Files are named `V<version>__<description>.sql` and run once, in order. **Never edit** a migration that has already run anywhere; add a new one.

## The service layer

Controllers handle HTTP, repositories handle persistence, and **services** hold the business logic and transaction boundaries in between:

```java
@Service
public class ProductService {
    private final ProductRepository repo;

    public ProductService(ProductRepository repo) { this.repo = repo; }

    @Transactional
    public Product create(CreateProduct cmd) {
        if (repo.existsBySku(cmd.sku())) {
            throw new DuplicateException("SKU " + cmd.sku() + " already exists");
        }
        return repo.save(new Product(cmd.name(), cmd.price(), cmd.sku()));
    }

    @Transactional(readOnly = true)
    public Product get(long id) {
        return repo.findById(id).orElseThrow(() -> new NotFoundException("Product " + id));
    }
}
```

## Worked example: from requirements to repository methods

The catalog page needs:

| Feature | Repository method |
|---|---|
| look up by ISBN (unique) | `Optional<Book> findByIsbn(String isbn)` |
| refuse duplicates | `boolean existsByIsbn(String isbn)` |
| search by author, any case, partial | `List<Book> findByAuthorContainingIgnoreCase(String author)` |
| "available now" list, paged | `Page<Book> findByAvailableTrue(Pageable pageable)` |
| newest additions | `List<Book> findTop10ByOrderByIdDesc()` |

None of those needs SQL: Spring Data derives the queries from the method names, and checks them at startup.

```java
@Service
public class BookService {
    private final BookRepository repo;

    public BookService(BookRepository repo) { this.repo = repo; }

    @Transactional
    public BookResponse add(BookRequest req) {
        if (repo.existsByIsbn(req.isbn())) {
            throw new DuplicateIsbnException("ISBN " + req.isbn() + " is already in the catalog");
        }
        Book saved = repo.save(new Book(req.isbn(), req.title(), req.author(), req.year()));
        return BookResponse.from(saved);
    }

    @Transactional(readOnly = true)
    public BookResponse get(long id) {
        return repo.findById(id).map(BookResponse::from)
                   .orElseThrow(() -> new BookNotFoundException("Book " + id + " not found"));
    }
}
```

> [!plain] In plain English
> An `@Entity` class is a table; each object is a row. A repository interface is a list of questions you can ask about that table, and Spring writes the SQL for each one.

## Common mistakes

> [!mistake] Relying only on `existsByIsbn`
> Two requests at the same moment can both see "not taken" and both insert. Add a **unique constraint** on the column too (`@Column(unique = true)` plus a migration), and turn the database's violation into the same 409.

:::quiz
q: Why is `@Enumerated(EnumType.STRING)` preferred over the default?
+ the default ORDINAL stores positions, so reordering or inserting enum constants silently changes the meaning of stored data
- STRING uses less storage
- ORDINAL isn't supported by PostgreSQL
- STRING enables lazy loading
why: Stored ordinals break as soon as the enum changes order.
:::

:::quiz
q: What does `findById` return in Spring Data JPA?
- the entity or null
+ an `Optional` of the entity
- a `List` with zero or one element
- it throws if not found
why: Optional forces callers to handle the missing case, e.g. with orElseThrow.
:::

:::quiz
q: Which `ddl-auto` value belongs in production?
- create-drop
- update
+ validate (or none), with Flyway or Liquibase managing the schema
- create
why: Production schemas should change only through reviewed, versioned migrations.
:::

:::quiz
q: `PageRequest.of(2, 10)` requests which rows?
- rows 20–30, page numbers start at 1
+ rows 21–30 (the third page), because pages are zero-based
- rows 2–12
- rows 11–20
why: Page 0 is the first page, so page 2 skips 20 rows.
:::

:::exercise
id: sj-entity
level: 2
title: Map an entity
mode: code
lang: java
file: Customer.java
---
Make `Customer` a JPA entity mapped to the table `customers`: `id` is the `@Id` with `GenerationType.IDENTITY`; `email` is a column that's `unique` and `nullable = false`; `tier` is stored as a **string**. Add a `protected` no-args constructor.
---starter
package com.example.demo;

import jakarta.persistence.*;

public class Customer {

    private Long id;

    private String email;

    private Tier tier;
}
---rule
@Entity
`@Entity`
---rule
@Table\(\s*name\s*=\s*"customers"\s*\)
`@Table(name = "customers")`
---rule
@Id\s*\n\s*@GeneratedValue\(\s*strategy\s*=\s*GenerationType\.IDENTITY\s*\)\s*\n\s*private\s+Long\s+id|@GeneratedValue\(\s*strategy\s*=\s*GenerationType\.IDENTITY\s*\)\s*\n\s*@Id\s*\n\s*private\s+Long\s+id
`@Id @GeneratedValue(strategy = GenerationType.IDENTITY)`
---rule
@Column\((?=[^)]*unique\s*=\s*true)(?=[^)]*nullable\s*=\s*false)[^)]*\)\s*\n\s*private\s+String\s+email
`@Column(unique = true, nullable = false)` on `email`
---rule
@Enumerated\(\s*EnumType\.STRING\s*\)\s*\n\s*private\s+Tier\s+tier
`@Enumerated(EnumType.STRING)` on `tier`
---rule
protected\s+Customer\(\s*\)\s*\{\s*\}
`protected Customer() {}`
---solution
package com.example.demo;

import jakarta.persistence.*;

@Entity
@Table(name = "customers")
public class Customer {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String email;

    @Enumerated(EnumType.STRING)
    private Tier tier;

    protected Customer() {}
}
:::

:::exercise
id: sj-repo
level: 1
title: A repository
mode: code
lang: java
file: CustomerRepository.java
---
Declare `CustomerRepository` as a Spring Data JPA repository for `Customer` entities with `Long` IDs.
---starter
package com.example.demo;

import org.springframework.data.jpa.repository.JpaRepository;
---rule
public\s+interface\s+CustomerRepository\s+extends\s+JpaRepository<\s*Customer\s*,\s*Long\s*>
`interface CustomerRepository extends JpaRepository<Customer, Long>`
---solution
package com.example.demo;

import org.springframework.data.jpa.repository.JpaRepository;

public interface CustomerRepository extends JpaRepository<Customer, Long> {
}
:::

:::exercise
id: sj-derived
level: 2
title: Derived queries
mode: code
lang: java
file: CustomerRepository.java
---
Add three derived query methods: `findByEmail` returning `Optional<Customer>`; `findByTierOrderByEmailAsc(Tier tier)` returning a `List<Customer>`; and `existsByEmail(String email)` returning `boolean`.
---starter
package com.example.demo;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CustomerRepository extends JpaRepository<Customer, Long> {
}
---rule
Optional<Customer>\s+findByEmail\(\s*String\s+email\s*\)\s*;
`Optional<Customer> findByEmail(String email);`
---rule
List<Customer>\s+findByTierOrderByEmailAsc\(\s*Tier\s+tier\s*\)\s*;
`List<Customer> findByTierOrderByEmailAsc(Tier tier);`
---rule
boolean\s+existsByEmail\(\s*String\s+email\s*\)\s*;
`boolean existsByEmail(String email);`
---solution
package com.example.demo;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CustomerRepository extends JpaRepository<Customer, Long> {
    Optional<Customer> findByEmail(String email);
    List<Customer> findByTierOrderByEmailAsc(Tier tier);
    boolean existsByEmail(String email);
}
:::

:::exercise
id: sj-query
level: 3
title: A JPQL query with a parameter
mode: code
lang: java
file: OrderRepository.java
---
Add a method `List<Order> bigOrders(@Param("min") BigDecimal min)` annotated with the JPQL query `select o from Order o where o.total >= :min order by o.total desc`.
---starter
package com.example.demo;

import java.math.BigDecimal;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderRepository extends JpaRepository<Order, Long> {
}
---rule
@Query\(\s*"select o from Order o where o\.total >= :min order by o\.total desc"\s*\)
The `@Query` with that JPQL
---rule
List<Order>\s+bigOrders\(\s*@Param\(\s*"min"\s*\)\s+BigDecimal\s+min\s*\)\s*;
`List<Order> bigOrders(@Param("min") BigDecimal min);`
---solution
package com.example.demo;

import java.math.BigDecimal;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("select o from Order o where o.total >= :min order by o.total desc")
    List<Order> bigOrders(@Param("min") BigDecimal min);
}
:::

:::exercise
id: sj-modifying
level: 3
title: A bulk update
mode: code
lang: java
file: CustomerRepository.java
---
Add `int downgradeInactive(@Param("since") Instant since)` that runs the JPQL update `update Customer c set c.tier = 'BASIC' where c.lastLogin < :since`. Remember the annotation that bulk updates need.
---starter
package com.example.demo;

import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CustomerRepository extends JpaRepository<Customer, Long> {
}
---rule
@Modifying
`@Modifying`
---rule
@Query\(\s*"update Customer c set c\.tier = 'BASIC' where c\.lastLogin < :since"\s*\)
The update query
---rule
int\s+downgradeInactive\(\s*@Param\(\s*"since"\s*\)\s+Instant\s+since\s*\)\s*;
`int downgradeInactive(@Param("since") Instant since);`
---solution
package com.example.demo;

import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CustomerRepository extends JpaRepository<Customer, Long> {

    @Modifying
    @Query("update Customer c set c.tier = 'BASIC' where c.lastLogin < :since")
    int downgradeInactive(@Param("since") Instant since);
}
:::

:::exercise
id: sj-page
level: 3
title: Paged endpoint
mode: code
lang: java
file: CustomerController.java
---
Write `GET /api/customers` taking `page` (default `"0"`) and `size` (default `"20"`) query parameters, build `PageRequest.of(page, size, Sort.by("email"))`, and return `repo.findAll(pageable)` as a `Page<Customer>`.
---starter
package com.example.demo;

import org.springframework.data.domain.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class CustomerController {

    private final CustomerRepository repo;

    public CustomerController(CustomerRepository repo) {
        this.repo = repo;
    }
}
---rule
@GetMapping\(\s*"/api/customers"\s*\)
`@GetMapping("/api/customers")`
---rule
@RequestParam\(\s*defaultValue\s*=\s*"0"\s*\)\s+int\s+page
`page` defaults to 0
---rule
@RequestParam\(\s*defaultValue\s*=\s*"20"\s*\)\s+int\s+size
`size` defaults to 20
---rule
PageRequest\.of\(\s*page\s*,\s*size\s*,\s*Sort\.by\(\s*"email"\s*\)\s*\)
`PageRequest.of(page, size, Sort.by("email"))`
---rule
public\s+Page<Customer>\s+\w+\(
Returns `Page<Customer>`
---rule
return\s+repo\.findAll\(\s*\w+\s*\)\s*;
`return repo.findAll(pageable);`
---solution
package com.example.demo;

import org.springframework.data.domain.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class CustomerController {

    private final CustomerRepository repo;

    public CustomerController(CustomerRepository repo) {
        this.repo = repo;
    }

    @GetMapping("/api/customers")
    public Page<Customer> list(@RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("email"));
        return repo.findAll(pageable);
    }
}
:::

:::exercise
id: sj-props
level: 2
title: Production datasource settings
mode: code
lang: properties
file: application-prod.properties
---
Write production settings: datasource URL `jdbc:postgresql://db:5432/shop`, username `shop`, password from the `DB_PASSWORD` environment variable via `${...}`, Hibernate `ddl-auto` set to `validate`, and open-in-view **disabled**.
---starter
# production database
---rule
^spring\.datasource\.url\s*=\s*jdbc:postgresql://db:5432/shop\s*$
`spring.datasource.url`
---rule
^spring\.datasource\.username\s*=\s*shop\s*$
`spring.datasource.username=shop`
---rule
^spring\.datasource\.password\s*=\s*\$\{DB_PASSWORD\}\s*$
`spring.datasource.password=${DB_PASSWORD}`
---rule
^spring\.jpa\.hibernate\.ddl-auto\s*=\s*validate\s*$
`spring.jpa.hibernate.ddl-auto=validate`
---rule
^spring\.jpa\.open-in-view\s*=\s*false\s*$
`spring.jpa.open-in-view=false`
---solution
# production database
spring.datasource.url=jdbc:postgresql://db:5432/shop
spring.datasource.username=shop
spring.datasource.password=${DB_PASSWORD}
spring.jpa.hibernate.ddl-auto=validate
spring.jpa.open-in-view=false
:::

:::exercise
id: sj-flyway-name
level: 2
title: Name the migration
mode: answer
---
Your project already has `V1__create_products.sql` and `V2__add_sku_index.sql`. The next migration adds a `discount` column. Its file name is `<prefix>add_discount.sql`. What is the prefix?
---answer
V3__
---solution
V3__
---explain
Flyway files are `V<version>__<description>.sql`: a capital V, a version higher than every applied one, then **two** underscores.
:::

:::exercise
id: proj-sp-05-entity
level: 2
title: "Project 5: the Book entity"
mode: code
lang: java
file: Book.java
---
Map `Book` to the table `books`: `id` is an identity-generated `Long` primary key; `isbn` is a column that's `unique` and `nullable = false` with `length = 13`; `title` and `author` are `nullable = false`; `available` is a `boolean` defaulting to `true`. Include a `protected` no-args constructor.
---starter
package org.library.bookshelf;

import jakarta.persistence.*;

public class Book {

    private Long id;
    private String isbn;
    private String title;
    private String author;
    private int year;
    private boolean available;
}
---rule
@Entity
`@Entity`
---rule
@Table\(\s*name\s*=\s*"books"\s*\)
`@Table(name = "books")`
---rule
@Id\s*\n\s*@GeneratedValue\(\s*strategy\s*=\s*GenerationType\.IDENTITY\s*\)\s*\n\s*private\s+Long\s+id
Identity primary key
---rule
@Column\((?=[^)]*unique\s*=\s*true)(?=[^)]*nullable\s*=\s*false)(?=[^)]*length\s*=\s*13)[^)]*\)\s*\n\s*private\s+String\s+isbn
`isbn`: unique, not null, length 13
---rule
@Column\(\s*nullable\s*=\s*false\s*\)\s*\n\s*private\s+String\s+title
`title` not null
---rule
@Column\(\s*nullable\s*=\s*false\s*\)\s*\n\s*private\s+String\s+author
`author` not null
---rule
private\s+boolean\s+available\s*=\s*true\s*;
`available` defaults to true
---rule
protected\s+Book\(\s*\)\s*\{\s*\}
`protected Book() {}`
---solution
package org.library.bookshelf;

import jakarta.persistence.*;

@Entity
@Table(name = "books")
public class Book {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 13)
    private String isbn;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String author;

    private int year;

    private boolean available = true;

    protected Book() {}
}
:::

:::exercise
id: proj-sp-05-repo
level: 2
title: "Project 5b: BookRepository"
mode: code
lang: java
file: BookRepository.java
---
Declare `BookRepository extends JpaRepository<Book, Long>` with: `Optional<Book> findByIsbn(String isbn)`, `boolean existsByIsbn(String isbn)`, `List<Book> findByAuthorContainingIgnoreCase(String author)` and `Page<Book> findByAvailableTrue(Pageable pageable)`.
---starter
package org.library.bookshelf;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
---rule
public\s+interface\s+BookRepository\s+extends\s+JpaRepository<\s*Book\s*,\s*Long\s*>
`extends JpaRepository<Book, Long>`
---rule
Optional<Book>\s+findByIsbn\(\s*String\s+isbn\s*\)\s*;
`findByIsbn`
---rule
boolean\s+existsByIsbn\(\s*String\s+isbn\s*\)\s*;
`existsByIsbn`
---rule
List<Book>\s+findByAuthorContainingIgnoreCase\(\s*String\s+author\s*\)\s*;
`findByAuthorContainingIgnoreCase`
---rule
Page<Book>\s+findByAvailableTrue\(\s*Pageable\s+pageable\s*\)\s*;
`findByAvailableTrue(Pageable)`
---solution
package org.library.bookshelf;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BookRepository extends JpaRepository<Book, Long> {
    Optional<Book> findByIsbn(String isbn);
    boolean existsByIsbn(String isbn);
    List<Book> findByAuthorContainingIgnoreCase(String author);
    Page<Book> findByAvailableTrue(Pageable pageable);
}
:::

:::exercise
id: proj-sp-05-add
level: 3
title: "Project 5c: adding a book"
mode: code
lang: java
file: BookService.java
---
Implement `add`: mark it `@Transactional`; if `repo.existsByIsbn(req.isbn())`, throw `new DuplicateIsbnException("ISBN " + req.isbn() + " is already in the catalog")`; otherwise save `new Book(req.isbn(), req.title(), req.author(), req.year())` and return `BookResponse.from(saved)`.
---starter
package org.library.bookshelf;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BookService {

    private final BookRepository repo;

    public BookService(BookRepository repo) {
        this.repo = repo;
    }

    public BookResponse add(BookRequest req) {
        return null;
    }
}
---rule
@Transactional\s*\n\s*public\s+BookResponse\s+add\(
`@Transactional` on `add`
---rule
if\s*\(\s*repo\.existsByIsbn\(\s*req\.isbn\(\s*\)\s*\)\s*\)
Check for duplicates
---rule
throw\s+new\s+DuplicateIsbnException\(\s*"ISBN "\s*\+\s*req\.isbn\(\s*\)\s*\+\s*" is already in the catalog"\s*\)
Throw the exception
---rule
repo\.save\(\s*new\s+Book\(\s*req\.isbn\(\s*\)\s*,\s*req\.title\(\s*\)\s*,\s*req\.author\(\s*\)\s*,\s*req\.year\(\s*\)\s*\)\s*\)
Save the new book
---rule
return\s+BookResponse\.from\(\s*\w+\s*\)\s*;
Return a `BookResponse`
---rule
!return\s+null
No `return null`
---solution
package org.library.bookshelf;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BookService {

    private final BookRepository repo;

    public BookService(BookRepository repo) {
        this.repo = repo;
    }

    @Transactional
    public BookResponse add(BookRequest req) {
        if (repo.existsByIsbn(req.isbn())) {
            throw new DuplicateIsbnException("ISBN " + req.isbn() + " is already in the catalog");
        }
        Book saved = repo.save(new Book(req.isbn(), req.title(), req.author(), req.year()));
        return BookResponse.from(saved);
    }
}
:::
