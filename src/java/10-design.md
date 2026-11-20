---
id: java-design
title: SOLID & design patterns
summary: The five SOLID principles with before-and-after examples, cohesion and coupling, composition over inheritance, and the patterns you'll meet most in real Java code: Strategy, Factory, Builder, Observer, Decorator and Adapter, plus unit testing an OO design with JUnit.
minutes: 45
---
> [!project] Taskboard, step 10: a design that bends instead of breaks
> Taskboard works, but new requirements keep arriving: holiday assignment periods, email *and* SMS notifications, a partner team's board in a different format. This step reorganizes it with SOLID principles and a few patterns, so each new requirement means **adding** a class, not editing ten.

## Cohesion and coupling

Two ideas sit under every principle below:

- **High cohesion**: everything in a class belongs together and serves one purpose.
- **Low coupling**: classes depend on each other as little as possible, and through small, stable interfaces.

## S: Single Responsibility

> A class should have one reason to change.

```java
class Planner {                         // before: three reasons to change
    Assignment assign(...) { ... }               //   assigning rules
    void emailReminder(Assignment l) { ... }   //   email formatting and SMTP
    void saveToCsv(List<Assignment> l) { ... } //   file format
}
```

After: `Planner` (rules), `Notifier` (messaging), `AssignmentExporter` (formats). A change to the email template can no longer break assigning.

## O: Open/Closed

> Open for extension, closed for modification.

Lesson 6 replaced an `instanceof` chain with `item.targetDays()`; lesson 5's `CreditPolicy` lets a new credit rule be a new class. New behaviour = new code, not edits to working code.

## L: Liskov Substitution

> Subtypes must be usable anywhere their parent is, without surprises.

`Milestone extends WorkItem` with a `pickUp()` that throws violated it; splitting out `Assignable` fixed it (lesson 6).

## I: Interface Segregation

> Don't force clients to depend on methods they don't use.

One giant `TaskboardService` interface with 30 methods forces every implementation (and every test fake) to deal with all of them. Prefer small, focused interfaces: `Assignable`, `Searchable`, `Notifier`.

## D: Dependency Inversion

> High-level code depends on abstractions, not on details.

```java
class Planner {
    private final EmailSender email = new SmtpEmailSender("smtp.taskboard.dev");   // before: hard-wired
}

class Planner {
    private final Notifier notifier;                                             // after: injected
    Planner(Notifier notifier) { this.notifier = notifier; }
}
```

The rules (`Planner`) no longer know whether notifications go by email, SMS or a test fake. This is exactly what Spring's dependency injection automates.

> [!plain] In plain English
> SOLID is five habits that keep code easy to change: small focused classes, extend instead of edit, subclasses that behave, small interfaces, and depending on "what" rather than "how".

## Patterns you'll meet constantly

### Strategy: swap an algorithm

`CreditPolicy` (lesson 5) **is** the Strategy pattern: an interface for an algorithm, several implementations, chosen at runtime.

```java
Planner planner = new Planner(member.isStudent() ? new InternalCreditPolicy() : new StandardCreditPolicy());
```

### Factory: centralize creation

```java
public final class Items {
    private Items() {}

    public static WorkItem fromRecord(String type, String id, String title, String extra) {
        return switch (type) {
            case "TASK" -> new Task(id, title, extra);
            case "BUG" -> new Bug(id, title, Integer.parseInt(extra));
            case "MILESTONE" -> new Milestone(id, title, Integer.parseInt(extra));
            default -> throw new IllegalArgumentException("Unknown item type: " + type);
        };
    }
}
```

Callers ask for an item; only the factory knows which classes exist and how to build them.

### Builder: many optional parameters

```java
Member m = Member.builder("Ada Lovelace")
        .email("ada@taskboard.dev")
        .phone("555-0100")
        .student(true)
        .build();
```

Instead of a constructor with eight parameters (half of them `null`), a builder names each one and validates once in `build()`. Lombok's `@Builder` and records with static factories are common shortcuts.

### Observer: tell interested parties

```java
public interface AssignmentListener {
    void onAssigned(Assignment assignment);
}

public class Planner {
    private final List<AssignmentListener> listeners = new ArrayList<>();

    public void addListener(AssignmentListener l) { listeners.add(l); }

    public Assignment assign(...) {
        Assignment assignment = ...;
        listeners.forEach(l -> l.onAssigned(assignment));       // email, stats, audit log… without Planner knowing them
        return assignment;
    }
}
```

### Decorator and Adapter, briefly

- **Decorator** wraps an object to add behaviour while keeping its interface: a `LoggingNotifier implements Notifier` that logs and then delegates to the real notifier. Java's I/O streams (`new BufferedReader(new FileReader(...))`) are decorators.
- **Adapter** makes an incompatible class fit an interface you need: a `PartnerBoardAdapter implements Searchable` that translates the partner team's API.

## Testing an OO design

Good OO design is **testable** design: injected dependencies can be replaced by fakes.

```java
class PlannerTest {
    @Test
    void assigningNotifiesListeners() {
        List<Assignment> seen = new ArrayList<>();
        Planner planner = new Planner(5);
        planner.addListener(seen::add);                        // a lambda as a fake listener

        Task api = new Task("TB-101", "Write API", "Ana");
        planner.assign(api, new Member("Ada", "ada@taskboard.dev"), LocalDate.of(2026, 3, 1));

        assertEquals(1, seen.size());
        assertFalse(api.isAvailable());
    }
}
```

> [!mistake] Patterns for their own sake
> A `TaskFactoryFactory` for a class with one constructor is complexity, not design. Reach for a pattern when you feel the pain it solves: duplicated conditionals (Strategy), complicated construction (Builder, Factory), one change rippling into many classes (Observer).

:::quiz
q: A class formats emails, applies assigning rules and writes CSV files. Which principle does it violate?
+ Single Responsibility
- Liskov Substitution
- Interface Segregation
- Open/Closed only
why: It has three unrelated reasons to change.
:::

:::quiz
q: `CreditPolicy` with `StandardCreditPolicy` and `InternalCreditPolicy`, chosen at runtime, is which pattern?
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
file: Planner.java
---
Add the Observer pattern to `Planner`: a `private final List<AssignmentListener> listeners = new ArrayList<>()`, `public void addListener(AssignmentListener l)` that adds it, and in `assign(...)`, notify every listener with `onAssigned(assignment)` before returning the assignment.
---starter
import java.util.ArrayList;
import java.util.List;

public class Planner {

    public Assignment assign(Task task, Member member) {
        Assignment assignment = createAssignment(task, member);
        return assignment;
    }
}
---rule
private\s+final\s+List<AssignmentListener>\s+listeners\s*=\s*new\s+ArrayList<>\(\s*\)
The listener list
---rule
public\s+void\s+addListener\(\s*AssignmentListener\s+l\s*\)\s*\{\s*listeners\.add\(\s*l\s*\)
`addListener`
---rule
listeners\.forEach\(\s*(\w+)\s*->\s*\1\.onAssigned\(\s*assignment\s*\)\s*\)|for\s*\(\s*AssignmentListener\s+(\w+)\s*:\s*listeners\s*\)\s*\{?\s*\2\.onAssigned\(\s*assignment\s*\)
Notify each listener
---rule
onAssigned\(\s*assignment\s*\)[\s\S]*return\s+assignment
Notify before returning
---solution
import java.util.ArrayList;
import java.util.List;

public class Planner {
    private final List<AssignmentListener> listeners = new ArrayList<>();

    public void addListener(AssignmentListener l) {
        listeners.add(l);
    }

    public Assignment assign(Task task, Member member) {
        Assignment assignment = createAssignment(task, member);
        listeners.forEach(l -> l.onAssigned(assignment));
        return assignment;
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
    private final SmtpEmailSender email = new SmtpEmailSender("smtp.taskboard.dev");

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
`ReadOnlyBoard` implements an interface with `add`, `remove` and `search`, but throws `UnsupportedOperationException` from `add` and `remove` because it only supports searching. Which SOLID principle suggests splitting the interface? (Two words.)
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
path: java/src/main/java/taskboard/Items.java
---
Write a `final` class `Items` with a private constructor and `public static WorkItem fromRecord(String type, String id, String title, String extra)` using a **switch expression**: `"TASK"` → `new Task(id, title, extra)`, `"BUG"` → `new Bug(id, title, Integer.parseInt(extra))`, `"MILESTONE"` → `new Milestone(id, title, Integer.parseInt(extra))`, otherwise throw `new IllegalArgumentException("Unknown item type: " + type)`.
---starter
---rule
public\s+final\s+class\s+Items
`public final class Items`
---rule
private\s+Items\(\s*\)\s*\{\s*\}
Private constructor
---rule
public\s+static\s+WorkItem\s+fromRecord\(\s*String\s+type\s*,\s*String\s+id\s*,\s*String\s+title\s*,\s*String\s+extra\s*\)
The factory method
---rule
return\s+switch\s*\(\s*type\s*\)
A switch expression
---rule
case\s+"TASK"\s*->\s*new\s+Task\(\s*id\s*,\s*title\s*,\s*extra\s*\)
Tasks
---rule
case\s+"BUG"\s*->\s*new\s+Bug\(\s*id\s*,\s*title\s*,\s*Integer\.parseInt\(\s*extra\s*\)\s*\)
Bugs
---rule
case\s+"MILESTONE"\s*->\s*new\s+Milestone\(\s*id\s*,\s*title\s*,\s*Integer\.parseInt\(\s*extra\s*\)\s*\)
Milestones
---rule
default\s*->\s*throw\s+new\s+IllegalArgumentException\(\s*"Unknown item type: "\s*\+\s*type\s*\)
Unknown types
---solution
public final class Items {
    private Items() {}

    public static WorkItem fromRecord(String type, String id, String title, String extra) {
        return switch (type) {
            case "TASK" -> new Task(id, title, extra);
            case "BUG" -> new Bug(id, title, Integer.parseInt(extra));
            case "MILESTONE" -> new Milestone(id, title, Integer.parseInt(extra));
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
file: PlannerTest.java
path: java/src/test/java/taskboard/PlannerTest.java
---
Write a JUnit 5 test `pickingUpMarksTaskAndNotifies()`: create `List<Assignment> seen = new ArrayList<>()`, a `Planner planner = new Planner(5)`, register `seen::add` as a listener, assign `api` to `ada`, then `assertEquals(1, seen.size())` and `assertFalse(api.isAvailable())`.
---starter
import static org.junit.jupiter.api.Assertions.*;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class PlannerTest {
    private final Task api = new Task("TB-101", "Write API", "Ana");
    private final Member ada = new Member("Ada", "ada@taskboard.dev");
}
---rule
@Test\s*\n\s*void\s+pickingUpMarksTaskAndNotifies\(\s*\)
The test method
---rule
List<Assignment>\s+seen\s*=\s*new\s+ArrayList<>\(\s*\)
Collect notifications
---rule
Planner\s+planner\s*=\s*new\s+Planner\(\s*5\s*\)
Create the planner
---rule
planner\.addListener\(\s*seen::add\s*\)
Register a fake listener
---rule
planner\.assign\(\s*api\s*,\s*ada\s*,
Assign the task
---rule
assertEquals\(\s*1\s*,\s*seen\.size\(\s*\)\s*\)
One notification
---rule
assertFalse\(\s*api\.isAvailable\(\s*\)\s*\)
The task is out
---solution
import static org.junit.jupiter.api.Assertions.*;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class PlannerTest {
    private final Task api = new Task("TB-101", "Write API", "Ana");
    private final Member ada = new Member("Ada", "ada@taskboard.dev");

    @Test
    void pickingUpMarksTaskAndNotifies() {
        List<Assignment> seen = new ArrayList<>();
        Planner planner = new Planner(5);
        planner.addListener(seen::add);

        planner.assign(api, ada, LocalDate.of(2026, 3, 1));

        assertEquals(1, seen.size());
        assertFalse(api.isAvailable());
    }
}
:::
