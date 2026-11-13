---
id: spring-relations
title: Relationships & transactions
summary: @ManyToOne and @OneToMany with mappedBy, owning sides and join columns, cascade and orphan removal, lazy vs eager loading, the N+1 query problem and fixes (fetch joins, @EntityGraph), @Transactional semantics, propagation, rollback rules, the self-invocation trap, dirty checking and optimistic locking with @Version.
minutes: 45
---
> [!project] Bookshelf, step 6: borrowing books
> The heart of a library: a **member** borrows a **book**, creating a **loan** with a due date. This step maps the relationships and writes `borrow` as a single transaction that can't leave the data half-updated.

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

## Worked example: modeling Member, Book and Loan

```
Member 1 ───< Loan >─── 1 Book
 (id, name, email)   (id, member_id, book_id, borrowed_on, due_on, returned_on)
```

A member has many loans over time; a book has many loans over time; each loan has exactly one member and one book. `Loan` holds both foreign keys, so it owns both relationships:

```java
@Entity
public class Loan {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "member_id")
    private Member member;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "book_id")
    private Book book;

    private LocalDate borrowedOn;
    private LocalDate dueOn;
    private LocalDate returnedOn;      // null while the book is out

    protected Loan() {}
    public Loan(Member member, Book book, LocalDate borrowedOn, LocalDate dueOn) { ... }
}
```

## Worked example: borrow as one transaction

Borrowing must check rules and change two things (create a loan, mark the book unavailable). If the second write failed after the first, you'd have a loan for a book that still shows as available.

```java
@Transactional
public LoanResponse borrow(long memberId, long bookId) {
    Member member = members.findById(memberId).orElseThrow(() -> new MemberNotFoundException(memberId));
    Book book = books.findById(bookId).orElseThrow(() -> new BookNotFoundException("Book " + bookId + " not found"));

    if (!book.isAvailable()) throw new BookUnavailableException(bookId);
    if (loans.countByMemberIdAndReturnedOnIsNull(memberId) >= policy.maxLoans()) throw new LoanLimitException(memberId);

    LocalDate today = LocalDate.now(clock);
    Loan loan = loans.save(new Loan(member, book, today, today.plusDays(policy.loanDays())));
    book.setAvailable(false);            // dirty checking writes this UPDATE at commit
    return LoanResponse.from(loan);
}
```

Every rule violation throws an unchecked exception, so the whole transaction rolls back, and the advice class from step 4 turns each exception into a 404 or 409.

> [!plain] In plain English
> `@Transactional` says "everything in this method succeeds together or not at all". Inside it, changing a loaded entity is enough: JPA notices and saves it when the method finishes.

## Common mistakes

> [!mistake] Two people borrowing the last copy at the same moment
> Both transactions read `available = true` and both succeed. Add `@Version` to `Book` (optimistic locking): the second commit fails with a conflict you can turn into a 409 "just borrowed by someone else".

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

:::exercise
id: proj-sp-06-loan
level: 3
title: "Project 6: the Loan entity"
mode: code
lang: java
file: Loan.java
---
Map `Loan`: an `@Entity` with an identity-generated `Long id`; **lazy, required** `@ManyToOne` associations to `Member member` (column `member_id`) and `Book book` (column `book_id`); and `LocalDate` fields `borrowedOn`, `dueOn` and `returnedOn`. Add a protected no-args constructor.
---starter
package org.library.bookshelf;

import jakarta.persistence.*;
import java.time.LocalDate;

public class Loan {
}
---rule
@Entity\s*\n\s*public\s+class\s+Loan
`@Entity`
---rule
@Id\s*\n?\s*@GeneratedValue\(\s*strategy\s*=\s*GenerationType\.IDENTITY\s*\)\s*\n?\s*private\s+Long\s+id
Identity id
---rule
@ManyToOne\((?=[^)]*fetch\s*=\s*FetchType\.LAZY)(?=[^)]*optional\s*=\s*false)[^)]*\)\s*\n\s*@JoinColumn\(\s*name\s*=\s*"member_id"\s*\)\s*\n\s*private\s+Member\s+member
Lazy, required `member` (`member_id`)
---rule
@ManyToOne\((?=[^)]*fetch\s*=\s*FetchType\.LAZY)(?=[^)]*optional\s*=\s*false)[^)]*\)\s*\n\s*@JoinColumn\(\s*name\s*=\s*"book_id"\s*\)\s*\n\s*private\s+Book\s+book
Lazy, required `book` (`book_id`)
---rule
private\s+LocalDate\s+borrowedOn[\s\S]*private\s+LocalDate\s+dueOn[\s\S]*private\s+LocalDate\s+returnedOn
The three dates
---rule
protected\s+Loan\(\s*\)\s*\{\s*\}
`protected Loan() {}`
---solution
package org.library.bookshelf;

import jakarta.persistence.*;
import java.time.LocalDate;

@Entity
public class Loan {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "member_id")
    private Member member;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "book_id")
    private Book book;

    private LocalDate borrowedOn;
    private LocalDate dueOn;
    private LocalDate returnedOn;

    protected Loan() {}
}
:::

:::exercise
id: proj-sp-06-borrow
level: 4
title: "Project 6b: borrow a book"
mode: code
lang: java
file: LoanService.java
---
Implement `borrow(long memberId, long bookId)` as a **transaction**: load the member (`members.findById(memberId).orElseThrow(() -> new MemberNotFoundException(memberId))`) and the book (same pattern with `BookNotFoundException("Book " + bookId + " not found")`); throw `BookUnavailableException(bookId)` if `!book.isAvailable()`; compute `today = LocalDate.now(clock)`; save `new Loan(member, book, today, today.plusDays(policy.loanDays()))`; call `book.setAvailable(false)`; return `LoanResponse.from(loan)`.
---starter
package org.library.bookshelf;

import java.time.Clock;
import java.time.LocalDate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LoanService {

    private final MemberRepository members;
    private final BookRepository books;
    private final LoanRepository loans;
    private final LoanPolicy policy;
    private final Clock clock;

    public LoanService(MemberRepository members, BookRepository books, LoanRepository loans, LoanPolicy policy, Clock clock) {
        this.members = members;
        this.books = books;
        this.loans = loans;
        this.policy = policy;
        this.clock = clock;
    }
}
---rule
@Transactional\s*\n\s*public\s+LoanResponse\s+borrow\(\s*long\s+memberId\s*,\s*long\s+bookId\s*\)
`@Transactional` `borrow(long memberId, long bookId)`
---rule
members\.findById\(\s*memberId\s*\)\.orElseThrow\(\s*\(\)\s*->\s*new\s+MemberNotFoundException\(\s*memberId\s*\)\s*\)
Load the member or 404
---rule
books\.findById\(\s*bookId\s*\)\.orElseThrow\(\s*\(\)\s*->\s*new\s+BookNotFoundException\(
Load the book or 404
---rule
if\s*\(\s*!\s*book\.isAvailable\(\s*\)\s*\)\s*(\{\s*)?throw\s+new\s+BookUnavailableException\(\s*bookId\s*\)
Refuse unavailable books
---rule
LocalDate\s+today\s*=\s*LocalDate\.now\(\s*clock\s*\)
Today from the clock
---rule
loans\.save\(\s*new\s+Loan\(\s*member\s*,\s*book\s*,\s*today\s*,\s*today\.plusDays\(\s*policy\.loanDays\(\s*\)\s*\)\s*\)\s*\)
Save the loan with its due date
---rule
book\.setAvailable\(\s*false\s*\)
Mark the book as out
---rule
return\s+LoanResponse\.from\(\s*\w+\s*\)
Return the response
---solution
package org.library.bookshelf;

import java.time.Clock;
import java.time.LocalDate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LoanService {

    private final MemberRepository members;
    private final BookRepository books;
    private final LoanRepository loans;
    private final LoanPolicy policy;
    private final Clock clock;

    public LoanService(MemberRepository members, BookRepository books, LoanRepository loans, LoanPolicy policy, Clock clock) {
        this.members = members;
        this.books = books;
        this.loans = loans;
        this.policy = policy;
        this.clock = clock;
    }

    @Transactional
    public LoanResponse borrow(long memberId, long bookId) {
        Member member = members.findById(memberId).orElseThrow(() -> new MemberNotFoundException(memberId));
        Book book = books.findById(bookId).orElseThrow(() -> new BookNotFoundException("Book " + bookId + " not found"));
        if (!book.isAvailable()) {
            throw new BookUnavailableException(bookId);
        }
        LocalDate today = LocalDate.now(clock);
        Loan loan = loans.save(new Loan(member, book, today, today.plusDays(policy.loanDays())));
        book.setAvailable(false);
        return LoanResponse.from(loan);
    }
}
:::

:::exercise
id: proj-sp-06-overdue
level: 3
title: "Project 6c: overdue loans without N+1"
mode: code
lang: java
file: LoanRepository.java
---
The overdue report shows each loan's member name and book title, and it's issuing one query per loan. Add `List<Loan> findOverdue(@Param("today") LocalDate today)` with the JPQL `select l from Loan l join fetch l.member join fetch l.book where l.returnedOn is null and l.dueOn < :today`.
---starter
package org.library.bookshelf;

import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface LoanRepository extends JpaRepository<Loan, Long> {
    long countByMemberIdAndReturnedOnIsNull(long memberId);
}
---rule
@Query\(\s*"select l from Loan l join fetch l\.member join fetch l\.book where l\.returnedOn is null and l\.dueOn < :today"\s*\)
The fetch-join query
---rule
List<Loan>\s+findOverdue\(\s*@Param\(\s*"today"\s*\)\s+LocalDate\s+today\s*\)\s*;
`findOverdue(@Param("today") LocalDate today)`
---solution
package org.library.bookshelf;

import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface LoanRepository extends JpaRepository<Loan, Long> {
    long countByMemberIdAndReturnedOnIsNull(long memberId);

    @Query("select l from Loan l join fetch l.member join fetch l.book where l.returnedOn is null and l.dueOn < :today")
    List<Loan> findOverdue(@Param("today") LocalDate today);
}
:::
