---
id: java-encapsulation
title: Encapsulation & immutability
summary: Access modifiers, private fields with getters and controlled setters, enforcing invariants in constructors and methods, validating arguments, immutable objects and defensive copies, records, and packages.
minutes: 35
---
> [!project] Taskboard, step 3: tasks that can't be broken
> In step 2, any code could write `api.available = false` or `api.key = "oops"` directly. Nothing stopped a task from having negative points or an empty title. This step **encapsulates** `Task` and `Member` so they can only change in valid ways.

## The problem with public fields

```java
Task api = new Task("TB-101", "Write API", "Ana", 3);
api.points = -5;              // nonsense, but compiles
api.title = null;           // a NullPointerException waiting to happen
api.available = false;      // "taken", but no assignment was recorded anywhere
```

Every class has **invariants**: facts that must always be true for its objects. For a task: the key looks like `TB-123`, the title isn't blank, the points aren't negative. With public fields, any line in the codebase can break them, and the bug shows up far away from where it was caused.

## Access modifiers

| Modifier | Visible from |
|---|---|
| `private` | only inside the same class |
| (none: "package-private") | classes in the same package |
| `protected` | same package, plus subclasses |
| `public` | everywhere |

The rule of thumb: **fields `private`, methods as private as possible**, and a small public surface designed on purpose.

## Encapsulated Task

```java
public class Task {
    private final String key;
    private final String title;
    private final String assignee;
    private final int points;
    private boolean available = true;

    public Task(String key, String title, String assignee, int points) {
        if (key == null || !key.matches("TB-\\d+")) {
            throw new IllegalArgumentException("key must be a key like `TB-123`: " + key);
        }
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title is required");
        }
        if (points > java.time.Year.now().getValue()) {
            throw new IllegalArgumentException("points is in the future: " + points);
        }
        this.key = key;
        this.title = title.strip();
        this.assignee = assignee;
        this.points = points;
    }

    public String getKey() { return key; }
    public String getTitle() { return title; }
    public String getAssignee() { return assignee; }
    public int getPoints() { return points; }
    public boolean isAvailable() { return available; }

    public void pickUp() {
        if (!available) {
            throw new IllegalStateException(title + " is already taken");
        }
        available = false;
    }

    public void putBack() {
        available = true;
    }
}
```

What changed:

- **Validation in the constructor**: it's impossible to create an invalid `Task`. If the constructor finishes, the object is valid.
- **`final` fields**: key, title, assignee and points can never change after construction.
- **Getters** expose values read-only. There are **no setters** for things that shouldn't change.
- **Behaviour instead of setters**: `available` changes only through `pickUp()` and `putBack()`, which enforce the rule "you can't pick up a taken task".

> [!plain] In plain English
> Encapsulation means an object guards its own data. Other code asks it to *do* things ("pick up yourself"), and the object decides whether that's allowed, instead of anyone reaching in and changing its insides.

> [!mistake] Generating a getter and setter for every field
> IDEs make it a two-click job, and it undoes encapsulation: a public setter is a public field with extra steps. Add a setter only when changing that value directly is a legitimate operation, and validate in it.

## Exceptions for broken rules

- `IllegalArgumentException`: a caller passed a bad argument (invalid key).
- `IllegalStateException`: the call isn't allowed in the object's current state (picking up a taken task).
- `Objects.requireNonNull(x, "x")`: throws a `NullPointerException` with a clear message, right where the bad value arrived.

Failing **fast and loudly** at the boundary is far better than letting a bad value travel and crash somewhere unrelated. Lesson 8 covers exceptions properly.

## Immutable objects

An **immutable** object never changes after construction. Private final fields and no mutator methods help, but mutable objects referenced by those fields also need defensive copies or immutable alternatives. Immutable objects are simple to reason about, safe to share between threads, and safe to use as map keys. `String`, `Integer` and `LocalDate` are immutable; "modifying" them returns a new object:

```java
LocalDate due = LocalDate.of(2026, 3, 1);
due.plusDays(14);              // returns a NEW date; due is unchanged
due = due.plusDays(14);        // keep the result
```

### Defensive copies

`final` stops reassigning a field, not mutating the object it points to:

```java
public class ReadingList {
    private final List<String> titles;

    public ReadingList(List<String> titles) {
        this.titles = List.copyOf(titles);       // copy in: the caller's list can't change ours
    }

    public List<String> getTitles() {
        return titles;                           // List.copyOf is unmodifiable, so safe to return
    }
}
```

## Records: immutable data in one line

For classes that are just data, Java 16+ has **records**:

```java
public record Key(String value) {
    public Key {                                      // compact constructor: validate
        if (value == null || !value.matches("TB-\\d+")) {
            throw new IllegalArgumentException("key must look like TB-123");
        }
    }
}

Key i = new Key("TB-101");
i.value();                  // accessor (no "get" prefix)
```

A record gets `private final` fields, a constructor, accessors, `equals`, `hashCode` and `toString` automatically. Records are only shallowly immutable: copy mutable components defensively. Use records for **values** (keys, money amounts, coordinates, DTOs); use classes for **entities** with identity and changing state (a `Task` that's taken and returned).

## Packages

Packages group related classes and give them a namespace: `dev.taskboard.Task`. The folder structure matches the package (`dev/taskboard/Task.java`), and `import` brings classes from other packages into scope. Package-private (no modifier) is useful for helpers that only classes in the same package should use.

:::quiz
q: Where should a `Task` check that its key is valid?
+ in its constructor, so an invalid Task can never exist
- in every method that uses the key
- in the code that calls `new Task(...)`
- in `toString()`
why: Validating at construction makes the invariant hold for the object's whole life.
:::

:::quiz
q: A field is `private final List<String> titles`. Can another class add to the list if it gets a reference to it?
+ yes, unless the list itself is unmodifiable: final only prevents reassigning the field
- no, final makes the list immutable
- only with reflection
- only in the same package
why: final applies to the reference, not to the object. Use List.copyOf or an unmodifiable view.
:::

:::quiz
q: Which exception fits "pickUp() was called on a task that's already taken"?
- IllegalArgumentException
+ IllegalStateException
- NullPointerException
- ArrayIndexOutOfBoundsException
why: The argument isn't wrong; the object's current state forbids the operation.
:::

:::quiz
q: What does `date.plusDays(14)` do to a `LocalDate`?
- changes it in place
+ returns a new LocalDate; the original is unchanged
- throws because dates are final
- returns null
why: LocalDate is immutable.
:::

:::exercise
id: je-private
level: 2
title: Lock down Member
mode: code
lang: java
file: Member.java
---
Make `Member`'s fields `private` (`name` and `email` also `final`), add public getters `getName()`, `getEmail()` and `getOpenTasks()`, and make the constructor and `addTask()` public. Don't add setters.
---starter
public class Member {
    String name;
    String email;
    int openTasks = 0;

    Member(String name, String email) {
        this.name = name;
        this.email = email;
    }

    void addTask() {
        openTasks++;
    }
}
---rule
private\s+final\s+String\s+name\s*;
`private final String name;`
---rule
private\s+final\s+String\s+email\s*;
`private final String email;`
---rule
private\s+int\s+openTasks(\s*=\s*0)?\s*;
`private int openTasks`
---rule
public\s+String\s+getName\(\s*\)\s*\{\s*return\s+(this\.)?name\s*;
`getName()`
---rule
public\s+String\s+getEmail\(\s*\)\s*\{\s*return\s+(this\.)?email\s*;
`getEmail()`
---rule
public\s+int\s+getOpenTasks\(\s*\)\s*\{\s*return\s+(this\.)?openTasks\s*;
`getOpenTasks()`
---rule
public\s+Member\(
Public constructor
---rule
public\s+void\s+addTask\(
Public `addTask()`
---rule
!void\s+set\w+\(
No setters
---solution
public class Member {
    private final String name;
    private final String email;
    private int openTasks = 0;

    public Member(String name, String email) {
        this.name = name;
        this.email = email;
    }

    public String getName() { return name; }
    public String getEmail() { return email; }
    public int getOpenTasks() { return openTasks; }

    public void addTask() {
        openTasks++;
    }
}
:::

:::exercise
id: je-guard
level: 2
title: Guard a state change
mode: code
lang: java
file: Task.java
---
Make `pickUp()` throw `new IllegalStateException(title + " is already taken")` when the task isn't available; otherwise set `available` to false.
---starter
public class Task {
    private final String title;
    private boolean available = true;

    public Task(String title) {
        this.title = title;
    }

    public void pickUp() {
        available = false;
    }
}
---rule
if\s*\(\s*!\s*(this\.)?available\s*\)\s*\{?\s*throw\s+new\s+IllegalStateException\(\s*title\s*\+\s*" is already taken"\s*\)
Throw when already taken
---rule
throw[\s\S]*available\s*=\s*false
Then mark it taken
---solution
public class Task {
    private final String title;
    private boolean available = true;

    public Task(String title) {
        this.title = title;
    }

    public void pickUp() {
        if (!available) {
            throw new IllegalStateException(title + " is already taken");
        }
        available = false;
    }
}
:::

:::exercise
id: je-record
level: 3
title: A validated record
mode: code
lang: java
file: Key.java
---
Write `public record Key(String value)` with a **compact constructor** that throws `new IllegalArgumentException("key must look like TB-123")` when `value` is null or doesn't match `TB-\\d+`.
---starter
---rule
public\s+record\s+Key\(\s*String\s+value\s*\)
`public record Key(String value)`
---rule
public\s+Key\s*\{
A compact constructor
---rule
value\s*==\s*null\s*\|\|\s*!\s*value\.matches\(\s*"TB-\\\\d\+"\s*\)
Null or not a key like `TB-123`
---rule
throw\s+new\s+IllegalArgumentException\(\s*"key must look like TB-123"\s*\)
Throw
---solution
public record Key(String value) {
    public Key {
        if (value == null || !value.matches("TB-\\d+")) {
            throw new IllegalArgumentException("key must look like TB-123");
        }
    }
}
:::

:::exercise
id: je-predict-date
level: 2
title: Predict: immutable dates
mode: answer
---
```java
LocalDate due = LocalDate.of(2026, 3, 1);
due.plusDays(14);
System.out.println(due);
```

What does it print?
---answer
2026-03-01
---solution
2026-03-01
:::

:::exercise
id: proj-java-03-book
level: 3
title: "Project 3: an encapsulated Task"
mode: code
lang: java
file: Task.java
path: java/src/main/java/taskboard/Task.java
---
Rewrite `Task`: all four data fields `private final`, `available` `private`; the public constructor throws `IllegalArgumentException("key must look like TB-123")` unless the key matches `TB-\\d+`, and `IllegalArgumentException("title is required")` when the title is null or blank; public getters `getKey()`, `getTitle()`, `getAssignee()`, `getPoints()` and `isAvailable()`; and public `pickUp()` that throws `IllegalStateException` when already taken.
---starter
public class Task {
    String key;
    String title;
    String assignee;
    int points;
    boolean available = true;

    Task(String key, String title, String assignee, int points) {
        this.key = key;
        this.title = title;
        this.assignee = assignee;
        this.points = points;
    }

    void pickUp() {
        available = false;
    }
}
---rule
private\s+final\s+String\s+key\s*;[\s\S]*private\s+final\s+String\s+title\s*;[\s\S]*private\s+final\s+String\s+assignee\s*;[\s\S]*private\s+final\s+int\s+points\s*;
`private final` data fields
---rule
private\s+boolean\s+available\s*=\s*true\s*;
`private boolean available = true;`
---rule
public\s+Task\(\s*String\s+key\s*,\s*String\s+title\s*,\s*String\s+assignee\s*,\s*int\s+points\s*\)
Public constructor
---rule
key\.matches\(\s*"TB-\\\\d\+"\s*\)[\s\S]*?throw\s+new\s+IllegalArgumentException\(\s*"key must look like TB-123"\s*\)
Validate the key
---rule
title\s*==\s*null\s*\|\|\s*title\.isBlank\(\s*\)[\s\S]*?throw\s+new\s+IllegalArgumentException\(\s*"title is required"\s*\)
Validate the title
---rule
public\s+String\s+getKey\(\s*\)[\s\S]*public\s+String\s+getTitle\(\s*\)[\s\S]*public\s+String\s+getAssignee\(\s*\)[\s\S]*public\s+int\s+getPoints\(\s*\)
Getters
---rule
public\s+boolean\s+isAvailable\(\s*\)\s*\{\s*return\s+(this\.)?available\s*;
`isAvailable()`
---rule
public\s+void\s+pickUp\(\s*\)\s*\{\s*if\s*\(\s*!\s*(this\.)?available\s*\)\s*\{?\s*throw\s+new\s+IllegalStateException\(
`pickUp()` guards its state
---rule
!void\s+set\w+\(
No setters
---solution
public class Task {
    private final String key;
    private final String title;
    private final String assignee;
    private final int points;
    private boolean available = true;

    public Task(String key, String title, String assignee, int points) {
        if (key == null || !key.matches("TB-\\d+")) {
            throw new IllegalArgumentException("key must look like TB-123");
        }
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title is required");
        }
        this.key = key;
        this.title = title;
        this.assignee = assignee;
        this.points = points;
    }

    public String getKey() { return key; }
    public String getTitle() { return title; }
    public String getAssignee() { return assignee; }
    public int getPoints() { return points; }
    public boolean isAvailable() { return available; }

    public void pickUp() {
        if (!available) {
            throw new IllegalStateException(title + " is already taken");
        }
        available = false;
    }

    public void putBack() {
        available = true;
    }
}
:::
