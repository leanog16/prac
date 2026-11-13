---
id: spring-relations
title: Relationships & transactions
summary: @ManyToOne and @OneToMany with mappedBy, owning sides and join columns, cascade and orphan removal, lazy vs eager loading, the N+1 query problem and fixes (fetch joins, @EntityGraph), @Transactional semantics, propagation, rollback rules, the self-invocation trap, dirty checking and optimistic locking with @Version.
minutes: 45
---
## Mapping relationships

An order has many lines; each line belongs to one order:

```java
@Entity
public class Order {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "customer_id")
    private Customer customer;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderLine> lines = new ArrayList<>();

    public void addLine(OrderLine line) {          // keep both sides in sync
        lines.add(line);
        line.setOrder(this);
    }
}

@Entity
public class OrderLine {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id")
    private Order order;

    private String sku;
    private int quantity;
}
```

- The side with the **foreign key column** (`OrderLine.order` → `order_id`) is the **owning side**. Only changes to the owning side are written to the database.
- `mappedBy = "order"` on the other side says "this is the inverse of `OrderLine.order`; don't create another join table or column".
- Helper methods like `addLine` keep the in-memory object graph consistent with what will be saved.

| Annotation | Typical use | Default fetch |
|---|---|---|
| `@ManyToOne` | line → order, order → customer | **EAGER** (override to LAZY) |
| `@OneToMany` | order → lines | LAZY |
| `@OneToOne` | user → profile | **EAGER** (override to LAZY) |
| `@ManyToMany` | student ↔ course (join table) | LAZY |

> [!tip] Make every association LAZY
> Put `fetch = FetchType.LAZY` on every `@ManyToOne` and `@OneToOne`, then load what each use case needs explicitly. Eager defaults load object graphs you didn't ask for, on every query.

For many-to-many relationships that need extra data (enrolment date, grade), model the join table as its own entity with two `@ManyToOne`s instead of using `@ManyToMany`.

## Cascades and orphan removal

- `cascade = CascadeType.ALL` on `Order.lines`: saving or deleting an order saves or deletes its lines.
- `orphanRemoval = true`: removing a line from the list deletes its row.
- Cascade from **parent to children** (aggregate root to its parts), never from child to parent, and never on `@ManyToOne` to shared entities like `Customer`.

## The N+1 query problem

```java
List<Order> orders = orderRepo.findAll();                  // 1 query
for (Order o : orders) {
    System.out.println(o.getCustomer().getName());         // +1 query per order!
}
```

Lazy loading fetches each customer when it's first touched: 100 orders, 101 queries. It's the most common JPA performance problem, and it's invisible until the table grows. Turn on SQL logging in development (`spring.jpa.show-sql=true` or `logging.level.org.hibernate.SQL=debug`) to see it.

Fixes, loading the association **in the same query**:

```java
@Query("select o from Order o join fetch o.customer where o.status = :status")
List<Order> findWithCustomer(@Param("status") Status status);

@EntityGraph(attributePaths = {"customer", "lines"})
List<Order> findByStatus(Status status);
```

Or fetch a DTO projection with exactly the columns you need. With collection fetch joins, watch for duplicate parent rows (use `select distinct`) and don't combine them with pagination (Hibernate would paginate in memory).

## LazyInitializationException

Touching a lazy association **after** the transaction (and the persistence context) closed throws `LazyInitializationException: could not initialize proxy - no Session`. Typical cause: a controller or Jackson serializing an entity whose lazy field wasn't loaded. The fix is to load what you need inside the service transaction (fetch join, entity graph) and return DTOs.

Spring Boot's `spring.jpa.open-in-view=true` (the default) hides this by keeping the session open during view rendering, which lets N+1 queries happen silently in the web layer. Set it to `false` and fix the loading properly.

## @Transactional

A **transaction** makes a group of database operations atomic: all commit or none do.

```java
@Service
public class TransferService {
    private final AccountRepository accounts;

    public TransferService(AccountRepository accounts) { this.accounts = accounts; }

    @Transactional
    public void transfer(long fromId, long toId, BigDecimal amount) {
        Account from = accounts.findById(fromId).orElseThrow();
        Account to = accounts.findById(toId).orElseThrow();
        from.withdraw(amount);          // throws InsufficientFundsException → rollback
        to.deposit(amount);
        // no save() needed: dirty checking flushes changes at commit
    }
}
```

- **Dirty checking**: inside a transaction, entities loaded by JPA are *managed*. Change a field and Hibernate writes an UPDATE at commit, with no `save()` call.
- **Rollback rules**: by default, **unchecked** exceptions (`RuntimeException`, `Error`) roll back, but **checked** exceptions **commit**. Use `@Transactional(rollbackFor = Exception.class)` if your code throws checked exceptions that should roll back.
- `@Transactional(readOnly = true)` on queries skips dirty checking and lets the driver optimize.
- Put transactions on **service** methods (one use case = one transaction), not on controllers or repositories.

### Propagation

| Propagation | Behavior |
|---|---|
| `REQUIRED` (default) | join the current transaction, or start one |
| `REQUIRES_NEW` | suspend the current one and run in a new, independent transaction (audit logs that must survive a rollback) |
| `MANDATORY` | fail if there's no current transaction |
| `NOT_SUPPORTED` | run without a transaction |

### The self-invocation trap

`@Transactional` works through a **proxy** that wraps your bean. A call from one method to another **in the same class** doesn't go through the proxy, so the annotation on the called method is ignored:

```java
@Service
public class ReportService {
    public void runAll() {
        generate();            // this.generate(): no proxy, so NO transaction
    }

    @Transactional
    public void generate() { ... }
}
```

Fix it by moving `generate` to another bean, or putting `@Transactional` on the outer method. The same proxy rule applies to `@Async` and `@Cacheable`. Proxies also only intercept **public** methods called from outside.

## Optimistic locking

Two users edit the same product; the second save silently overwrites the first (a **lost update**). Add a version column:

```java
@Version
private long version;
```

Every UPDATE now includes `where id = ? and version = ?` and increments the version. If someone else updated the row in between, zero rows match and JPA throws `OptimisticLockException` (Spring: `ObjectOptimisticLockingFailureException`). Map it to **409 Conflict** and let the client reload and retry.

:::quiz
q: In a bidirectional Order ↔ OrderLine mapping, which side is the owning side?
+ OrderLine.order, the side with the @JoinColumn / foreign key
- Order.lines, the side with mappedBy
- both
- whichever was saved first
why: The owning side holds the foreign key. mappedBy marks the inverse side.
:::

:::quiz
q: Loading 50 orders and then calling `order.getCustomer().getName()` on each issues how many queries with lazy loading?
- 1
- 2
+ 51
- 50
why: One for the orders plus one per customer: the N+1 problem. Fix it with join fetch or @EntityGraph.
:::

:::quiz
q: A @Transactional method throws a checked `IOException`. By default the transaction…
- rolls back
+ commits
- stays open
- is retried
why: Only unchecked exceptions roll back by default. Use rollbackFor for checked ones.
:::

:::quiz
q: `methodA()` (no annotation) calls `this.methodB()` (`@Transactional`) in the same bean. Is methodB transactional?
- yes, always
+ no: the internal call bypasses the Spring proxy
- only if methodB is private
- only in tests
why: Proxy-based AOP only intercepts calls coming from outside the bean.
:::

:::quiz
q: What does `@Version` protect against?
- SQL injection
+ lost updates from concurrent edits (optimistic locking)
- deadlocks
- N+1 queries
why: The version check makes a stale update fail instead of overwriting newer data.
:::

:::exercise
id: sre-many-to-one
level: 2
title: Map the owning side
mode: code
lang: java
file: Comment.java
---
Map `post` as a **lazy**, required (`optional = false`) many-to-one association stored in the column `post_id`.
---starter
package com.example.demo;

import jakarta.persistence.*;

@Entity
public class Comment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Post post;

    private String text;
}
---rule
@ManyToOne\((?=[^)]*fetch\s*=\s*FetchType\.LAZY)(?=[^)]*optional\s*=\s*false)[^)]*\)
`@ManyToOne(fetch = FetchType.LAZY, optional = false)`
---rule
@JoinColumn\(\s*name\s*=\s*"post_id"[^)]*\)\s*\n\s*private\s+Post\s+post|@JoinColumn\(\s*name\s*=\s*"post_id"[^)]*\)
`@JoinColumn(name = "post_id")`
---solution
package com.example.demo;

import jakarta.persistence.*;

@Entity
public class Comment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "post_id")
    private Post post;

    private String text;
}
:::

:::exercise
id: sre-one-to-many
level: 3
title: The inverse side, with cascades
mode: code
lang: java
file: Post.java
---
Map `comments` as the inverse side of `Comment.post`, cascading **all** operations and removing orphans. Then complete `addComment` so it adds the comment to the list **and** sets its `post` to `this`.
---starter
package com.example.demo;

import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;

@Entity
public class Post {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private List<Comment> comments = new ArrayList<>();

    public void addComment(Comment c) {
    }
}
---rule
@OneToMany\((?=[^)]*mappedBy\s*=\s*"post")(?=[^)]*cascade\s*=\s*CascadeType\.ALL)(?=[^)]*orphanRemoval\s*=\s*true)[^)]*\)
`@OneToMany(mappedBy = "post", cascade = CascadeType.ALL, orphanRemoval = true)`
---rule
comments\.add\(\s*c\s*\)\s*;
Add to the list
---rule
c\.setPost\(\s*this\s*\)\s*;
Set the owning side
---solution
package com.example.demo;

import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;

@Entity
public class Post {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToMany(mappedBy = "post", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Comment> comments = new ArrayList<>();

    public void addComment(Comment c) {
        comments.add(c);
        c.setPost(this);
    }
}
:::

:::exercise
id: sre-fetch-join
level: 3
title: Kill the N+1
mode: code
lang: java
file: CommentRepository.java
---
The comments page loads each comment's post lazily (N+1). Add `List<Comment> findAllWithPost()` with a JPQL `@Query` that **join fetches** `c.post`: `select c from Comment c join fetch c.post`.
---starter
package com.example.demo;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface CommentRepository extends JpaRepository<Comment, Long> {
}
---rule
@Query\(\s*"select c from Comment c join fetch c\.post"\s*\)
`@Query("select c from Comment c join fetch c.post")`
---rule
List<Comment>\s+findAllWithPost\(\s*\)\s*;
`List<Comment> findAllWithPost();`
---solution
package com.example.demo;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface CommentRepository extends JpaRepository<Comment, Long> {

    @Query("select c from Comment c join fetch c.post")
    List<Comment> findAllWithPost();
}
:::

:::exercise
id: sre-entity-graph
level: 3
title: Same fix, with an entity graph
mode: code
lang: java
file: OrderRepository.java
---
Add a derived query `List<Order> findByStatus(Status status)` that loads `customer` and `lines` in the same query using `@EntityGraph`.
---starter
package com.example.demo;

import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderRepository extends JpaRepository<Order, Long> {
}
---rule
@EntityGraph\(\s*attributePaths\s*=\s*\{\s*"customer"\s*,\s*"lines"\s*\}\s*\)|@EntityGraph\(\s*attributePaths\s*=\s*\{\s*"lines"\s*,\s*"customer"\s*\}\s*\)
`@EntityGraph(attributePaths = {"customer", "lines"})`
---rule
List<Order>\s+findByStatus\(\s*Status\s+status\s*\)\s*;
`List<Order> findByStatus(Status status);`
---solution
package com.example.demo;

import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderRepository extends JpaRepository<Order, Long> {

    @EntityGraph(attributePaths = {"customer", "lines"})
    List<Order> findByStatus(Status status);
}
:::

:::exercise
id: sre-transactional
level: 3
title: An atomic transfer
mode: code
lang: java
file: TransferService.java
---
Make `transfer` run in a transaction that rolls back on **any** exception (checked ones included), and remove the redundant `save` calls: dirty checking handles them.
---starter
package com.example.demo;

import java.math.BigDecimal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TransferService {

    private final AccountRepository accounts;

    public TransferService(AccountRepository accounts) {
        this.accounts = accounts;
    }

    public void transfer(long fromId, long toId, BigDecimal amount) throws Exception {
        Account from = accounts.findById(fromId).orElseThrow();
        Account to = accounts.findById(toId).orElseThrow();
        from.withdraw(amount);
        accounts.save(from);
        to.deposit(amount);
        accounts.save(to);
    }
}
---rule
@Transactional\(\s*rollbackFor\s*=\s*Exception\.class\s*\)\s*\n\s*public\s+void\s+transfer
`@Transactional(rollbackFor = Exception.class)` on `transfer`
---rule
!accounts\.save\(
No `save` calls
---rule
from\.withdraw\(\s*amount\s*\)[\s\S]*to\.deposit\(\s*amount\s*\)
Still withdraws and deposits
---solution
package com.example.demo;

import java.math.BigDecimal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TransferService {

    private final AccountRepository accounts;

    public TransferService(AccountRepository accounts) {
        this.accounts = accounts;
    }

    @Transactional(rollbackFor = Exception.class)
    public void transfer(long fromId, long toId, BigDecimal amount) throws Exception {
        Account from = accounts.findById(fromId).orElseThrow();
        Account to = accounts.findById(toId).orElseThrow();
        from.withdraw(amount);
        to.deposit(amount);
    }
}
:::

:::exercise
id: sre-requires-new
level: 3
title: An audit log that survives rollback
mode: code
lang: java
file: AuditService.java
---
`record(String event)` must be committed even when the caller's transaction rolls back. Annotate it so it always runs in its **own new** transaction.
---starter
package com.example.demo;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditService {

    private final AuditRepository audits;

    public AuditService(AuditRepository audits) {
        this.audits = audits;
    }

    public void record(String event) {
        audits.save(new AuditEntry(event));
    }
}
---rule
@Transactional\(\s*propagation\s*=\s*Propagation\.REQUIRES_NEW\s*\)\s*\n\s*public\s+void\s+record
`@Transactional(propagation = Propagation.REQUIRES_NEW)`
---solution
package com.example.demo;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditService {

    private final AuditRepository audits;

    public AuditService(AuditRepository audits) {
        this.audits = audits;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String event) {
        audits.save(new AuditEntry(event));
    }
}
:::

:::exercise
id: sre-version
level: 2
title: Optimistic locking
mode: code
lang: java
file: Product.java
---
Protect `Product` against lost updates by adding a `long version` field managed by JPA.
---starter
package com.example.demo;

import jakarta.persistence.*;

@Entity
public class Product {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    private int stock;
}
---rule
@Version\s*\n\s*private\s+(long|Long|int|Integer)\s+version\s*;
`@Version private long version;`
---solution
package com.example.demo;

import jakarta.persistence.*;

@Entity
public class Product {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    private int stock;

    @Version
    private long version;
}
:::

:::exercise
id: sre-lazy-ex
level: 3
title: Name that exception
mode: answer
---
A controller returns a JPA entity, `open-in-view` is `false`, and Jackson tries to serialize a lazy `@OneToMany` collection after the service's transaction ended. Which exception class is thrown?
---answer
LazyInitializationException
---answer
org.hibernate.LazyInitializationException
---solution
LazyInitializationException
:::
