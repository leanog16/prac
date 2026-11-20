---
id: java-interfaces
title: Interfaces & abstract classes
summary: Abstract classes and abstract methods, interfaces as contracts, implementing several interfaces, default and static methods, Comparable and Comparator, choosing between an interface and an abstract class, and programming to an interface.
minutes: 40
---
> [!project] Taskboard, step 5: contracts
> Not every item can be picked up (milestones can't), and Taskboard's client agencies get different credits when work is late: paying clients get money back, internal boards get nothing. Instead of special cases everywhere, this step defines **contracts**: an `Assignable` interface for things someone can pick up, and a `CreditPolicy` interface for "how much credit does a late task earn the client?".

## Abstract classes

Should anyone ever write `new WorkItem(...)`? No: every real item is a task, a bug or a milestone. Mark the class **abstract**, and declare methods every subclass **must** provide without a body:

```java
public abstract class WorkItem {
    private final String id;
    private final String title;

    protected WorkItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    public String getTitle() { return title; }

    public abstract String describe();       // no body: each subclass must implement it
}
```

- `new WorkItem(...)` is now a compile error.
- A concrete subclass that forgets `describe()` doesn't compile either.
- Abstract classes can still have fields, constructors and normal methods: they share **state and code**.

## Interfaces: what something can do

An **interface** is a pure contract: method signatures without state.

```java
public interface Assignable {
    int targetDays();
    boolean isAvailable();
    void pickUp();
    void putBack();
}
```

```java
public class Task extends WorkItem implements Assignable {
    private boolean available = true;
    // ...
    @Override public int targetDays() { return 21; }
    @Override public boolean isAvailable() { return available; }
    @Override public void pickUp() { /* check and set */ }
    @Override public void putBack() { available = true; }
    @Override public String describe() { return getTitle(); }
}

public class Milestone extends WorkItem {         // NOT Assignable
    @Override public String describe() { return getTitle() + " (milestone)"; }
}
```

Now the type system itself says milestones can't be taken. A method `void assign(Assignable item, Member m)` **can't even be called** with a milestone: the mistake is caught at compile time instead of throwing at runtime (compare lesson 4's `UnsupportedOperationException`).

> [!plain] In plain English
> An interface is a promise: "anything that implements me has these methods". Code that only needs the promise doesn't care which class keeps it.

## Several interfaces, one parent

A class can **extend one** class but **implement many** interfaces:

```java
public class Bug extends WorkItem implements Assignable, Comparable<Bug>, Rateable { ... }
```

That's why capabilities ("can be taken", "can be compared", "can be rated") are interfaces: they combine freely.

## Default and static methods

Interfaces can include **default** methods (with a body) that implementers inherit, and **static** helpers:

```java
public interface Assignable {
    int targetDays();
    boolean isAvailable();
    void pickUp();
    void putBack();

    default LocalDate dueDateFrom(LocalDate start) {      // shared behaviour, overridable
        return start.plusDays(targetDays());
    }

    static boolean anyAvailable(List<? extends Assignable> items) {
        return items.stream().anyMatch(Assignable::isAvailable);
    }
}
```

Default methods let interfaces grow without breaking existing implementations. They can't touch fields, because interfaces have no instance state.

## Comparable and Comparator

How should tasks be sorted? Give the class a **natural order** with `Comparable`, and supply other orders with `Comparator`:

```java
public class Task extends WorkItem implements Comparable<Task> {
    @Override
    public int compareTo(Task other) {
        return getTitle().compareTo(other.getTitle());     // negative, zero or positive
    }
}

tasks.sort(null);                                            // natural order: by title
tasks.sort(Comparator.comparing(Task::getPoints));             // by points
tasks.sort(Comparator.comparing(Task::getAssignee)
                     .thenComparing(Task::getPoints).reversed());
```

## Interface or abstract class?

| | Interface | Abstract class |
|---|---|---|
| models | a **capability** ("can be taken") | a **family** sharing code and state ("is a work item") |
| state (fields) | no (only constants) | yes |
| constructors | no | yes |
| a class can have | many | one |
| use it when | unrelated classes share behaviour, or you want callers decoupled from implementations | subclasses share real implementation and data |

Common combination: an interface for the contract, plus an optional abstract class implementing the boring parts.

## Program to an interface

```java
List<Task> tasks = new ArrayList<>();         // declare the interface type
Map<String, Task> byKey = new HashMap<>();
CreditPolicy credits = new StandardCreditPolicy();
```

Code that depends on `List` works with **any** list; code that depends on `ArrayList` is stuck with it. The same idea drives Spring's dependency injection: depend on the interface, receive an implementation.

:::quiz
q: What does marking `WorkItem` as `abstract` prevent?
+ creating `WorkItem` objects directly with `new`
- subclassing it
- calling its methods
- giving it fields
why: Abstract classes can't be instantiated; only concrete subclasses can.
:::

:::quiz
q: How many classes can a Java class extend, and how many interfaces can it implement?
- one and one
+ one class, many interfaces
- many and many
- many classes, one interface
why: Single inheritance of classes, multiple implementation of interfaces.
:::

:::quiz
q: What must `compareTo(other)` return when `this` should come **before** `other`?
+ a negative number
- a positive number
- zero
- true
why: Negative means less-than, zero equal, positive greater-than.
:::

:::quiz
q: Why is `List<Task> tasks = new ArrayList<>()` preferred over `ArrayList<Task> tasks = …`?
+ the rest of the code depends only on the List contract, so the implementation can change
- ArrayList is deprecated
- it's faster
- List has more methods
why: Programming to an interface keeps code flexible.
:::

:::exercise
id: jif-borrowable
level: 2
title: The Assignable contract
mode: code
lang: java
file: Assignable.java
---
Write `public interface Assignable` with abstract methods `int targetDays()`, `boolean isAvailable()`, `void pickUp()` and `void putBack()`, plus a **default** method `LocalDate dueDateFrom(LocalDate start)` returning `start.plusDays(targetDays())`.
---starter
import java.time.LocalDate;
---rule
public\s+interface\s+Assignable
`public interface Assignable`
---rule
int\s+targetDays\(\s*\)\s*;
`int targetDays();`
---rule
boolean\s+isAvailable\(\s*\)\s*;
`boolean isAvailable();`
---rule
void\s+pickUp\(\s*\)\s*;
`void pickUp();`
---rule
void\s+putBack\(\s*\)\s*;
`void putBack();`
---rule
default\s+LocalDate\s+dueDateFrom\(\s*LocalDate\s+start\s*\)\s*\{\s*return\s+start\.plusDays\(\s*targetDays\(\s*\)\s*\)\s*;
The default method
---solution
import java.time.LocalDate;

public interface Assignable {
    int targetDays();
    boolean isAvailable();
    void pickUp();
    void putBack();

    default LocalDate dueDateFrom(LocalDate start) {
        return start.plusDays(targetDays());
    }
}
:::

:::exercise
id: jif-abstract
level: 2
title: An abstract base
mode: code
lang: java
file: WorkItem.java
---
Make `WorkItem` **abstract**, make its constructor `protected`, and add an abstract method `public abstract String describe();`.
---starter
public class WorkItem {
    private final String id;
    private final String title;

    public WorkItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    public String getTitle() { return title; }
}
---rule
public\s+abstract\s+class\s+WorkItem
`public abstract class WorkItem`
---rule
protected\s+WorkItem\(\s*String\s+id\s*,\s*String\s+title\s*\)
Protected constructor
---rule
public\s+abstract\s+String\s+describe\(\s*\)\s*;
Abstract `describe()`
---solution
public abstract class WorkItem {
    private final String id;
    private final String title;

    protected WorkItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    public String getTitle() { return title; }

    public abstract String describe();
}
:::

:::exercise
id: jif-comparator
level: 3
title: Sort the board
mode: code
lang: java
file: Board.java
---
Write `static void sortForDisplay(List<Task> tasks)` that sorts by assignee, then by points **highest first**, using `Comparator.comparing(Task::getAssignee).thenComparing(Task::getPoints, Comparator.reverseOrder())`.
---starter
import java.util.Comparator;
import java.util.List;

public class Board {
}
---rule
static\s+void\s+sortForDisplay\(\s*List<Task>\s+tasks\s*\)
The signature
---rule
tasks\.sort\(\s*Comparator\.comparing\(\s*Task::getAssignee\s*\)\s*\.thenComparing\(\s*Task::getPoints\s*,\s*Comparator\.reverseOrder\(\s*\)\s*\)\s*\)
Assignee, then highest points first
---solution
import java.util.Comparator;
import java.util.List;

public class Board {
    static void sortForDisplay(List<Task> tasks) {
        tasks.sort(Comparator.comparing(Task::getAssignee).thenComparing(Task::getPoints, Comparator.reverseOrder()));
    }
}
:::

:::exercise
id: jif-predict-default
level: 2
title: Predict: a default method
mode: answer
---
A `Bug` implements `Assignable` with `targetDays()` returning `7` and doesn't override `dueDateFrom`. What does `bug.dueDateFrom(LocalDate.of(2026, 3, 1))` return (ISO format)?
---answer
2026-03-08
---solution
2026-03-08
:::

:::exercise
id: proj-java-05-fees
level: 3
title: "Project 5: credit policies"
mode: code
lang: java
file: CreditPolicy.java
path: java/src/main/java/taskboard/CreditPolicy.java
---
Write `public interface CreditPolicy` with `BigDecimal creditFor(long daysLate)`, and two implementations: `StandardCreditPolicy` returning `new BigDecimal("0.25").multiply(BigDecimal.valueOf(daysLate))`, and `InternalCreditPolicy` returning `BigDecimal.ZERO` (students pay no credits). Both with `@Override`.
---starter
import java.math.BigDecimal;
---rule
public\s+interface\s+CreditPolicy\s*\{\s*BigDecimal\s+creditFor\(\s*long\s+daysLate\s*\)\s*;
The interface
---rule
class\s+StandardCreditPolicy\s+implements\s+CreditPolicy
`StandardCreditPolicy implements CreditPolicy`
---rule
new\s+BigDecimal\(\s*"0\.25"\s*\)\.multiply\(\s*BigDecimal\.valueOf\(\s*daysLate\s*\)\s*\)
25 cents per day
---rule
class\s+InternalCreditPolicy\s+implements\s+CreditPolicy
`InternalCreditPolicy implements CreditPolicy`
---rule
InternalCreditPolicy[\s\S]*return\s+BigDecimal\.ZERO\s*;
Students pay nothing
---rule
(@Override\s*\n\s*public\s+BigDecimal\s+creditFor[\s\S]*){2}
Both override `creditFor`
---solution
import java.math.BigDecimal;

public interface CreditPolicy {
    BigDecimal creditFor(long daysLate);
}

class StandardCreditPolicy implements CreditPolicy {
    @Override
    public BigDecimal creditFor(long daysLate) {
        return new BigDecimal("0.25").multiply(BigDecimal.valueOf(daysLate));
    }
}

class InternalCreditPolicy implements CreditPolicy {
    @Override
    public BigDecimal creditFor(long daysLate) {
        return BigDecimal.ZERO;
    }
}
:::

:::exercise
id: proj-java-05-book-borrowable
level: 3
title: "Project 5b: Task implements Assignable"
mode: code
lang: java
file: Task.java
path: java/src/main/java/taskboard/Task.java
---
Make `Task` extend the abstract `WorkItem` **and** implement `Assignable` and `Comparable<Task>`: implement `targetDays()` (21), `isAvailable()`, `pickUp()` (throw `IllegalStateException` if not available), `putBack()`, `describe()` (returns `getTitle() + " by " + assignee`), and `compareTo(Task other)` comparing titles.
---starter
public class Task extends WorkItem {
    private final String assignee;
    private boolean available = true;

    public Task(String key, String title, String assignee) {
        super(key, title);
        this.assignee = assignee;
    }
}
---rule
public\s+class\s+Task\s+extends\s+WorkItem\s+implements\s+(Assignable\s*,\s*Comparable<Task>|Comparable<Task>\s*,\s*Assignable)
Extends one, implements two
---rule
public\s+int\s+targetDays\(\s*\)\s*\{\s*return\s+21\s*;
`targetDays()` → 21
---rule
public\s+boolean\s+isAvailable\(\s*\)\s*\{\s*return\s+(this\.)?available\s*;
`isAvailable()`
---rule
public\s+void\s+pickUp\(\s*\)\s*\{\s*if\s*\(\s*!\s*(this\.)?available\s*\)\s*\{?\s*throw\s+new\s+IllegalStateException\(
`pickUp()` guards its state
---rule
public\s+void\s+putBack\(\s*\)\s*\{\s*(this\.)?available\s*=\s*true\s*;
`putBack()`
---rule
public\s+String\s+describe\(\s*\)\s*\{\s*return\s+getTitle\(\s*\)\s*\+\s*" by "\s*\+\s*assignee\s*;
`describe()`
---rule
public\s+int\s+compareTo\(\s*Task\s+other\s*\)\s*\{\s*return\s+getTitle\(\s*\)\.compareTo\(\s*other\.getTitle\(\s*\)\s*\)\s*;
`compareTo` by title
---solution
public class Task extends WorkItem implements Assignable, Comparable<Task> {
    private final String assignee;
    private boolean available = true;

    public Task(String key, String title, String assignee) {
        super(key, title);
        this.assignee = assignee;
    }

    @Override
    public int targetDays() { return 21; }

    @Override
    public boolean isAvailable() { return available; }

    @Override
    public void pickUp() {
        if (!available) {
            throw new IllegalStateException(getTitle() + " is already taken");
        }
        available = false;
    }

    @Override
    public void putBack() { available = true; }

    @Override
    public String describe() { return getTitle() + " by " + assignee; }

    @Override
    public int compareTo(Task other) { return getTitle().compareTo(other.getTitle()); }
}
:::
