---
id: java-design
title: SOLID & design patterns
summary: The five SOLID principles with before-and-after examples, cohesion and coupling, composition over inheritance, and the patterns you'll meet most in real Java code: Strategy, Factory, Builder, Observer, Decorator and Adapter, plus unit testing an OO design with JUnit.
minutes: 45
---
> [!project] Bookshelf, step 10: a design that bends instead of breaks
> Bookshelf works, but new requirements keep arriving: holiday loan periods, email *and* SMS notifications, a partner library's catalog in a different format. This step reorganizes it with SOLID principles and a few patterns, so each new requirement means **adding** a class, not editing ten.

## Cohesion and coupling

Two ideas sit under every principle below:

- **High cohesion**: everything in a class belongs together and serves one purpose.
- **Low coupling**: classes depend on each other as little as possible, and through small, stable interfaces.

## S: Single Responsibility

> A class should have one reason to change.

```java
class LoanDesk {                         // before: three reasons to change
    Loan lend(...) { ... }               //   lending rules
    void emailReminder(Loan l) { ... }   //   email formatting and SMTP
    void saveToCsv(List<Loan> l) { ... } //   file format
}
```

After: `LoanDesk` (rules), `Notifier` (messaging), `LoanExporter` (formats). A change to the email template can no longer break lending.

## O: Open/Closed

> Open for extension, closed for modification.

Lesson 6 replaced an `instanceof` chain with `item.loanDays()`; lesson 5's `FeePolicy` lets a new fee rule be a new class. New behaviour = new code, not edits to working code.

## L: Liskov Substitution

> Subtypes must be usable anywhere their parent is, without surprises.

`Magazine extends LibraryItem` with a `borrow()` that throws violated it; splitting out `Borrowable` fixed it (lesson 6).

## I: Interface Segregation

> Don't force clients to depend on methods they don't use.

One giant `LibraryService` interface with 30 methods forces every implementation (and every test fake) to deal with all of them. Prefer small, focused interfaces: `Borrowable`, `Searchable`, `Notifier`.

## D: Dependency Inversion

> High-level code depends on abstractions, not on details.

```java
class LoanDesk {
    private final EmailSender email = new SmtpEmailSender("smtp.lib.example");   // before: hard-wired
}

class LoanDesk {
    private final Notifier notifier;                                             // after: injected
    LoanDesk(Notifier notifier) { this.notifier = notifier; }
}
```

The rules (`LoanDesk`) no longer know whether notifications go by email, SMS or a test fake. This is exactly what Spring's dependency injection automates.

> [!plain] In plain English
> SOLID is five habits that keep code easy to change: small focused classes, extend instead of edit, subclasses that behave, small interfaces, and depending on "what" rather than "how".

## Patterns you'll meet constantly

### Strategy: swap an algorithm

`FeePolicy` (lesson 5) **is** the Strategy pattern: an interface for an algorithm, several implementations, chosen at runtime.

```java
LoanDesk desk = new LoanDesk(member.isStudent() ? new StudentFeePolicy() : new StandardFeePolicy());
```

### Factory: centralize creation

```java
public final class Items {
    private Items() {}

    public static LibraryItem fromRecord(String type, String id, String title, String extra) {
        return switch (type) {
            case "BOOK" -> new Book(id, title, extra);
            case "DVD" -> new Dvd(id, title, Integer.parseInt(extra));
            case "MAG" -> new Magazine(id, title, Integer.parseInt(extra));
            default -> throw new IllegalArgumentException("Unknown item type: " + type);
        };
    }
}
```

Callers ask for an item; only the factory knows which classes exist and how to build them.

### Builder: many optional parameters

```java
Member m = Member.builder("Ada Lovelace")
        .email("ada@lib.example")
        .phone("555-0100")
        .student(true)
        .build();
```

Instead of a constructor with eight parameters (half of them `null`), a builder names each one and validates once in `build()`. Lombok's `@Builder` and records with static factories are common shortcuts.

### Observer: tell interested parties

```java
public interface LoanListener {
    void onLent(Loan loan);
}

public class LoanDesk {
    private final List<LoanListener> listeners = new ArrayList<>();

    public void addListener(LoanListener l) { listeners.add(l); }

    public Loan lend(...) {
        Loan loan = ...;
        listeners.forEach(l -> l.onLent(loan));       // email, stats, audit log… without LoanDesk knowing them
        return loan;
    }
}
```

### Decorator and Adapter, briefly

- **Decorator** wraps an object to add behaviour while keeping its interface: a `LoggingNotifier implements Notifier` that logs and then delegates to the real notifier. Java's I/O streams (`new BufferedReader(new FileReader(...))`) are decorators.
- **Adapter** makes an incompatible class fit an interface you need: a `PartnerCatalogAdapter implements Searchable` that translates the partner library's API.

## Testing an OO design

Good OO design is **testable** design: injected dependencies can be replaced by fakes.

```java
class LoanDeskTest {
    @Test
    void lendingNotifiesListeners() {
        List<Loan> seen = new ArrayList<>();
        LoanDesk desk = new LoanDesk(5);
        desk.addListener(seen::add);                        // a lambda as a fake listener

        Book dune = new Book("9780441013593", "Dune", "Frank Herbert");
        desk.lend(dune, new Member("Ada", "ada@lib.example"), LocalDate.of(2026, 3, 1));

        assertEquals(1, seen.size());
        assertFalse(dune.isAvailable());
    }
}
```

> [!mistake] Patterns for their own sake
> A `BookFactoryFactory` for a class with one constructor is complexity, not design. Reach for a pattern when you feel the pain it solves: duplicated conditionals (Strategy), complicated construction (Builder, Factory), one change rippling into many classes (Observer).

:::quiz
q: A class formats emails, applies lending rules and writes CSV files. Which principle does it violate?
+ Single Responsibility
- Liskov Substitution
- Interface Segregation
- Open/Closed only
why: It has three unrelated reasons to change.
:::

:::quiz
q: `FeePolicy` with `StandardFeePolicy` and `StudentFeePolicy`, chosen at runtime, is which pattern?
- Observer
- Builder
+ Strategy
- Adapter
why: Interchangeable algorithms behind one interface.
:::

:::quiz
q: What does Dependency Inversion ask for?
+ high-level classes depend on interfaces, and concrete implementations are supplied from outside
- subclasses invert their parent's behaviour
- dependencies are created inside each class
- every class has an interface
why: Rules shouldn't hard-code infrastructure details.
:::

:::quiz
q: When is a Builder most useful?
- for classes with one field
+ for objects with many parameters, especially optional ones
- for singletons
- for interfaces
why: It replaces long, error-prone constructor calls with named steps.
:::

:::exercise
id: jd-observer
level: 3
title: An observer hook
mode: code
lang: java
file: LoanDesk.java
---
Add the Observer pattern to `LoanDesk`: a `private final List<LoanListener> listeners = new ArrayList<>()`, `public void addListener(LoanListener l)` that adds it, and in `lend(...)`, notify every listener with `onLent(loan)` before returning the loan.
---starter
import java.util.ArrayList;
import java.util.List;

public class LoanDesk {

    public Loan lend(Book book, Member member) {
        Loan loan = createLoan(book, member);
        return loan;
    }
}
---rule
private\s+final\s+List<LoanListener>\s+listeners\s*=\s*new\s+ArrayList<>\(\s*\)
The listener list
---rule
public\s+void\s+addListener\(\s*LoanListener\s+l\s*\)\s*\{\s*listeners\.add\(\s*l\s*\)
`addListener`
---rule
listeners\.forEach\(\s*(\w+)\s*->\s*\1\.onLent\(\s*loan\s*\)\s*\)|for\s*\(\s*LoanListener\s+(\w+)\s*:\s*listeners\s*\)\s*\{?\s*\2\.onLent\(\s*loan\s*\)
Notify each listener
---rule
onLent\(\s*loan\s*\)[\s\S]*return\s+loan
Notify before returning
---solution
import java.util.ArrayList;
import java.util.List;

public class LoanDesk {
    private final List<LoanListener> listeners = new ArrayList<>();

    public void addListener(LoanListener l) {
        listeners.add(l);
    }

    public Loan lend(Book book, Member member) {
        Loan loan = createLoan(book, member);
        listeners.forEach(l -> l.onLent(loan));
        return loan;
    }
}
:::

:::exercise
id: jd-di
level: 2
title: Invert the dependency
mode: code
lang: java
file: ReminderService.java
---
`ReminderService` creates its own `SmtpEmailSender`. Change it to receive a `Notifier` through its constructor (stored in a `private final Notifier notifier`) and call `notifier.send(email, text)`.
---starter
public class ReminderService {
    private final SmtpEmailSender email = new SmtpEmailSender("smtp.lib.example");

    public void remind(String address, String title) {
        email.sendMail(address, "Please return " + title);
    }
}
---rule
private\s+final\s+Notifier\s+notifier\s*;
`private final Notifier notifier;`
---rule
public\s+ReminderService\(\s*Notifier\s+notifier\s*\)\s*\{\s*this\.notifier\s*=\s*notifier\s*;
Constructor injection
---rule
notifier\.send\(\s*address\s*,\s*"Please return "\s*\+\s*title\s*\)
Use the abstraction
---rule
!new\s+SmtpEmailSender
No hard-wired implementation
---solution
public class ReminderService {
    private final Notifier notifier;

    public ReminderService(Notifier notifier) {
        this.notifier = notifier;
    }

    public void remind(String address, String title) {
        notifier.send(address, "Please return " + title);
    }
}
:::

:::exercise
id: jd-principle
level: 2
title: Name the principle
mode: answer
---
`ReadOnlyCatalog` implements an interface with `add`, `remove` and `search`, but throws `UnsupportedOperationException` from `add` and `remove` because it only supports searching. Which SOLID principle suggests splitting the interface? (Two words.)
---answer
interface segregation
---answer
interface segregation principle
---answer
ISP
---solution
interface segregation
:::

:::exercise
id: proj-java-10-factory
level: 3
title: "Project 10: an item factory"
mode: code
lang: java
file: Items.java
---
Write a `final` class `Items` with a private constructor and `public static LibraryItem fromRecord(String type, String id, String title, String extra)` using a **switch expression**: `"BOOK"` → `new Book(id, title, extra)`, `"DVD"` → `new Dvd(id, title, Integer.parseInt(extra))`, `"MAG"` → `new Magazine(id, title, Integer.parseInt(extra))`, otherwise throw `new IllegalArgumentException("Unknown item type: " + type)`.
---starter
---rule
public\s+final\s+class\s+Items
`public final class Items`
---rule
private\s+Items\(\s*\)\s*\{\s*\}
Private constructor
---rule
public\s+static\s+LibraryItem\s+fromRecord\(\s*String\s+type\s*,\s*String\s+id\s*,\s*String\s+title\s*,\s*String\s+extra\s*\)
The factory method
---rule
return\s+switch\s*\(\s*type\s*\)
A switch expression
---rule
case\s+"BOOK"\s*->\s*new\s+Book\(\s*id\s*,\s*title\s*,\s*extra\s*\)
Books
---rule
case\s+"DVD"\s*->\s*new\s+Dvd\(\s*id\s*,\s*title\s*,\s*Integer\.parseInt\(\s*extra\s*\)\s*\)
DVDs
---rule
case\s+"MAG"\s*->\s*new\s+Magazine\(\s*id\s*,\s*title\s*,\s*Integer\.parseInt\(\s*extra\s*\)\s*\)
Magazines
---rule
default\s*->\s*throw\s+new\s+IllegalArgumentException\(\s*"Unknown item type: "\s*\+\s*type\s*\)
Unknown types
---solution
public final class Items {
    private Items() {}

    public static LibraryItem fromRecord(String type, String id, String title, String extra) {
        return switch (type) {
            case "BOOK" -> new Book(id, title, extra);
            case "DVD" -> new Dvd(id, title, Integer.parseInt(extra));
            case "MAG" -> new Magazine(id, title, Integer.parseInt(extra));
            default -> throw new IllegalArgumentException("Unknown item type: " + type);
        };
    }
}
:::

:::exercise
id: proj-java-10-test
level: 3
title: "Project 10b: a JUnit test"
mode: code
lang: java
file: LoanDeskTest.java
---
Write a JUnit 5 test `lendingMarksBookAndNotifies()`: create `List<Loan> seen = new ArrayList<>()`, a `LoanDesk desk = new LoanDesk(5)`, register `seen::add` as a listener, lend `dune` to `ada`, then `assertEquals(1, seen.size())` and `assertFalse(dune.isAvailable())`.
---starter
import static org.junit.jupiter.api.Assertions.*;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class LoanDeskTest {
    private final Book dune = new Book("9780441013593", "Dune", "Frank Herbert");
    private final Member ada = new Member("Ada", "ada@lib.example");
}
---rule
@Test\s*\n\s*void\s+lendingMarksBookAndNotifies\(\s*\)
The test method
---rule
List<Loan>\s+seen\s*=\s*new\s+ArrayList<>\(\s*\)
Collect notifications
---rule
LoanDesk\s+desk\s*=\s*new\s+LoanDesk\(\s*5\s*\)
Create the desk
---rule
desk\.addListener\(\s*seen::add\s*\)
Register a fake listener
---rule
desk\.lend\(\s*dune\s*,\s*ada\s*,
Lend the book
---rule
assertEquals\(\s*1\s*,\s*seen\.size\(\s*\)\s*\)
One notification
---rule
assertFalse\(\s*dune\.isAvailable\(\s*\)\s*\)
The book is out
---solution
import static org.junit.jupiter.api.Assertions.*;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class LoanDeskTest {
    private final Book dune = new Book("9780441013593", "Dune", "Frank Herbert");
    private final Member ada = new Member("Ada", "ada@lib.example");

    @Test
    void lendingMarksBookAndNotifies() {
        List<Loan> seen = new ArrayList<>();
        LoanDesk desk = new LoanDesk(5);
        desk.addListener(seen::add);

        desk.lend(dune, ada, LocalDate.of(2026, 3, 1));

        assertEquals(1, seen.size());
        assertFalse(dune.isAvailable());
    }
}
:::
