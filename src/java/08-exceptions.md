---
id: java-exceptions
title: Exceptions & error handling
summary: How exceptions propagate, try/catch/finally, checked vs unchecked exceptions, the exception hierarchy, throwing with good messages, custom exception classes, try-with-resources, wrapping causes, and what not to do (swallowing, catching Exception everywhere, exceptions for control flow).
minutes: 35
---
> [!project] Taskboard, step 8: failures with names
> Picking up can fail in several ways: the item is already taken, the member already has too many tasks, or the member still has overdue work to finish. Right now those are generic `IllegalStateException`s. This step gives each failure its own exception type, so the code that calls `pick up` can react to each one properly.

## What happens when something throws

```java
public static void main(String[] args) {
    checkout("D-404");
}
static void checkout(String id) {
    WorkItem item = find(id);          // 2. find throws, so checkout stops here...
    item.pickUp();
}
static WorkItem find(String id) {
    throw new NoSuchElementException("No item " + id);   // 1. thrown here
}
```

```
Exception in thread "main" java.util.NoSuchElementException: No item D-404
    at Main.find(Main.java:9)
    at Main.checkout(Main.java:5)
    at Main.main(Main.java:2)
```

An exception **unwinds the call stack**: each method stops immediately, until some caller **catches** it. If nobody does, the thread dies and prints a **stack trace**. Read it top-down: the first line is the problem, the next lines say where it happened, most recent call first.

## try / catch / finally

```java
try {
    planner.assign(item, member);
    System.out.println("Enjoy your task!");
} catch (TaskTakenException e) {
    System.out.println("Sorry, " + e.getMessage() + ". Want to reserve it?");
} catch (WorkloadLimitException | OverdueWorkException e) {   // multi-catch
    System.out.println("Can't assign right now: " + e.getMessage());
} finally {
    audit.log("assign attempted");          // runs whether it succeeded, failed or returned
}
```

Catch blocks are checked in order, so put **specific** types before general ones.

> [!plain] In plain English
> `throw` means "I can't continue; someone above me must deal with this". `try`/`catch` means "I know how to deal with this kind of problem".

## Checked vs unchecked

```
Throwable
├── Error                          serious JVM problems (OutOfMemoryError): don't catch
└── Exception                      checked: callers MUST catch or declare `throws`
    ├── IOException, SQLException, …
    └── RuntimeException           unchecked: no declaration needed
        ├── NullPointerException, IllegalArgumentException, IllegalStateException, …
        └── your domain exceptions (usually)
```

- **Checked** exceptions (`IOException`) must be caught or declared with `throws` on the method. They're for recoverable problems outside your control: a missing file, a network error.
- **Unchecked** exceptions (`RuntimeException` subclasses) don't need declaring. They're for programming errors (null, bad argument) and, in most modern code, for **business rule violations** too.

Most modern Java code (and Spring) uses unchecked exceptions for domain errors: checked exceptions tend to spread `throws` clauses through every layer without anyone handling them better.

## Custom exceptions

```java
public class TaskboardException extends RuntimeException {
    public TaskboardException(String message) { super(message); }
}

public class TaskTakenException extends TaskboardException {
    private final String itemId;

    public TaskTakenException(String itemId, String title) {
        super(title + " is already on assignment");
        this.itemId = itemId;
    }

    public String getItemId() { return itemId; }
}
```

- Name them after **what went wrong** in domain terms.
- A shared base class (`TaskboardException`) lets callers catch "any Taskboard rule violation" in one place, which is exactly what a web layer's error handler does.
- Put useful data on them (`itemId`), not just in the message.

## Good messages

`throw new IllegalArgumentException("bad input")` helps nobody. Say **what** was wrong and **with which value**: `"key must be a key like `TB-123`, got '97804410'"`. The person reading it at 2 a.m. might be you.

## try-with-resources

Files, sockets and database connections must be **closed**, even when an exception happens. Any `AutoCloseable` declared in the `try (...)` header is closed automatically:

```java
try (BufferedReader in = Files.newBufferedReader(Path.of("board.csv"))) {
    String line;
    while ((line = in.readLine()) != null) {
        board.add(parse(line));
    }
} catch (IOException e) {
    throw new BoardLoadException("Couldn't read board.csv", e);   // keep the cause
}
```

Passing the original exception as the **cause** (`e`) keeps its stack trace attached: the log shows both your message and the underlying `NoSuchFileException`.

## What not to do

> [!mistake] Swallowing exceptions
> `catch (Exception e) { }` hides the failure. The program continues in a broken state, and nobody knows why. If you truly can't handle it, let it propagate, or at least log it.

> [!mistake] Catching Exception everywhere
> Catch the specific types you can handle. A blanket `catch (Exception e)` also catches bugs like `NullPointerException` that you *want* to see.

> [!mistake] Exceptions for normal control flow
> "Not found" when looking something up is often a normal outcome, not an exception. Return `Optional` (next lesson) and save exceptions for situations that are truly exceptional for that method.

:::quiz
q: Which exceptions must be caught or declared with `throws`?
+ checked exceptions (subclasses of Exception that aren't RuntimeException)
- all exceptions
- RuntimeException and its subclasses
- Errors
why: The compiler enforces handling only for checked exceptions.
:::

:::quiz
q: When does a `finally` block run?
- only if no exception was thrown
- only if an exception was caught
+ always, whether the try block completed, threw, or returned
- never, if there's a return
why: finally is for cleanup that must always happen.
:::

:::quiz
q: Why pass the original exception when wrapping: `new BoardLoadException("…", e)`?
+ to keep the root cause and its stack trace for debugging
- it's required by the compiler
- to make the exception checked
- to rethrow e automatically
why: The cause chain shows what really failed underneath.
:::

:::quiz
q: What does try-with-resources guarantee?
- the resource is never null
+ the resource's close() is called automatically, even if an exception is thrown
- exceptions are swallowed
- the code runs in a transaction
why: It's the safe way to manage files, streams and connections.
:::

:::exercise
id: jx-custom
level: 2
title: A custom exception
mode: code
lang: java
file: WorkloadLimitException.java
---
Write `WorkloadLimitException extends TaskboardException` with a `private final int limit` field, and a constructor `WorkloadLimitException(String memberName, int limit)` that calls `super(memberName + " already has " + limit + " open tasks")` and stores the limit. Add `getLimit()`.
---starter
---rule
public\s+class\s+WorkloadLimitException\s+extends\s+TaskboardException
`extends TaskboardException`
---rule
private\s+final\s+int\s+limit\s*;
`private final int limit;`
---rule
WorkloadLimitException\(\s*String\s+memberName\s*,\s*int\s+limit\s*\)\s*\{\s*super\(\s*memberName\s*\+\s*" already has "\s*\+\s*limit\s*\+\s*" open tasks"\s*\)\s*;
Constructor with a clear message
---rule
this\.limit\s*=\s*limit\s*;
Store the limit
---rule
public\s+int\s+getLimit\(\s*\)\s*\{\s*return\s+(this\.)?limit\s*;
`getLimit()`
---solution
public class WorkloadLimitException extends TaskboardException {
    private final int limit;

    public WorkloadLimitException(String memberName, int limit) {
        super(memberName + " already has " + limit + " open tasks");
        this.limit = limit;
    }

    public int getLimit() {
        return limit;
    }
}
:::

:::exercise
id: jx-twr
level: 3
title: Read a file safely
mode: code
lang: java
file: BoardLoader.java
---
Write `static List<String> loadTitles(Path file)` that reads every line with a `BufferedReader` from `Files.newBufferedReader(file)` in a **try-with-resources**, adds each line to a list, and on `IOException` throws `new BoardLoadException("Couldn't read " + file, e)`.
---starter
import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class BoardLoader {
}
---rule
static\s+List<String>\s+loadTitles\(\s*Path\s+file\s*\)
The signature
---rule
try\s*\(\s*BufferedReader\s+(\w+)\s*=\s*Files\.newBufferedReader\(\s*file\s*\)\s*\)
try-with-resources
---rule
while\s*\(\s*\(\s*(\w+)\s*=\s*\w+\.readLine\(\s*\)\s*\)\s*!=\s*null\s*\)
Read line by line
---rule
catch\s*\(\s*IOException\s+e\s*\)\s*\{\s*throw\s+new\s+BoardLoadException\(\s*"Couldn't read "\s*\+\s*file\s*,\s*e\s*\)
Wrap with the cause
---rule
return\s+\w+\s*;
Return the list
---solution
import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class BoardLoader {
    static List<String> loadTitles(Path file) {
        List<String> titles = new ArrayList<>();
        try (BufferedReader in = Files.newBufferedReader(file)) {
            String line;
            while ((line = in.readLine()) != null) {
                titles.add(line);
            }
        } catch (IOException e) {
            throw new BoardLoadException("Couldn't read " + file, e);
        }
        return titles;
    }
}
:::

:::exercise
id: jx-predict-finally
level: 3
title: Predict: finally always runs
mode: answer
---
```java
static String go() {
    try {
        System.out.print("A");
        throw new IllegalStateException();
    } catch (IllegalStateException e) {
        System.out.print("B");
        return "C";
    } finally {
        System.out.print("D");
    }
}
System.out.println(go());
```

What does it print?
---answer
ABDC
---solution
ABDC
---explain
The catch prints B and prepares to return "C", then finally prints D before the method actually returns, and finally println prints C.
:::

:::exercise
id: jx-predict-order
level: 2
title: Predict: which catch?
mode: answer
---
`TaskTakenException extends TaskboardException extends RuntimeException`. What does this print?

```java
try {
    throw new TaskTakenException("B-1", "Write API");
} catch (TaskTakenException e) {
    System.out.println("unavailable");
} catch (TaskboardException e) {
    System.out.println("taskboard");
}
```
---answer
unavailable
---solution
unavailable
:::

:::exercise
id: proj-java-08-lend
level: 4
title: "Project 8: the assignment planner"
mode: code
lang: java
file: Planner.java
path: java/src/main/java/taskboard/Planner.java
---
Write `public Assignment assign(Task task, Member member, LocalDate today)` in `Planner` that checks, in this order: if `!task.isAvailable()` throw `new TaskTakenException(task.getKey(), task.getTitle())`; if `member.getOpenTasks() >= maxTasks` throw `new WorkloadLimitException(member.getName(), maxTasks)`. Otherwise call `task.pickUp()`, `member.addTask()`, and return `new Assignment(task, member, today.plusDays(task.targetDays()))`.
---starter
import java.time.LocalDate;

public class Planner {
    private final int maxTasks;

    public Planner(int maxTasks) {
        this.maxTasks = maxTasks;
    }
}
---rule
public\s+Assignment\s+assign\(\s*Task\s+task\s*,\s*Member\s+member\s*,\s*LocalDate\s+today\s*\)
The signature
---rule
if\s*\(\s*!\s*task\.isAvailable\(\s*\)\s*\)\s*\{?\s*throw\s+new\s+TaskTakenException\(\s*task\.getKey\(\s*\)\s*,\s*task\.getTitle\(\s*\)\s*\)
Unavailable → `TaskTakenException`
---rule
if\s*\(\s*member\.getOpenTasks\(\s*\)\s*>=\s*maxTasks\s*\)\s*\{?\s*throw\s+new\s+WorkloadLimitException\(\s*member\.getName\(\s*\)\s*,\s*maxTasks\s*\)
Too many open tasks → `WorkloadLimitException`
---rule
TaskTakenException[\s\S]*WorkloadLimitException
Availability checked first
---rule
task\.pickUp\(\s*\)\s*;[\s\S]*member\.addTask\(\s*\)\s*;
Pick up, then count the assignment
---rule
return\s+new\s+Assignment\(\s*task\s*,\s*member\s*,\s*today\.plusDays\(\s*task\.targetDays\(\s*\)\s*\)\s*\)\s*;
Return the assignment
---solution
import java.time.LocalDate;

public class Planner {
    private final int maxTasks;

    public Planner(int maxTasks) {
        this.maxTasks = maxTasks;
    }

    public Assignment assign(Task task, Member member, LocalDate today) {
        if (!task.isAvailable()) {
            throw new TaskTakenException(task.getKey(), task.getTitle());
        }
        if (member.getOpenTasks() >= maxTasks) {
            throw new WorkloadLimitException(member.getName(), maxTasks);
        }
        task.pickUp();
        member.addTask();
        return new Assignment(task, member, today.plusDays(task.targetDays()));
    }
}
:::

:::exercise
id: proj-java-08-handle
level: 3
title: "Project 8b: handle the failures"
mode: code
lang: java
file: Kiosk.java
path: java/src/main/java/taskboard/Kiosk.java
---
Write `static String tryAssign(Planner planner, Task task, Member member, LocalDate today)` that calls `planner.assign(...)` and returns `"Due " + assignment.getDueOn()`; catches `TaskTakenException` returning `"Unavailable: " + e.getMessage()`; and catches `TaskboardException` (any other rule) returning `"Refused: " + e.getMessage()`.
---starter
import java.time.LocalDate;

public class Kiosk {
}
---rule
static\s+String\s+tryAssign\(\s*Planner\s+planner\s*,\s*Task\s+task\s*,\s*Member\s+member\s*,\s*LocalDate\s+today\s*\)
The signature
---rule
try\s*\{\s*Assignment\s+(\w+)\s*=\s*planner\.assign\(\s*task\s*,\s*member\s*,\s*today\s*\)\s*;\s*return\s+"Due "\s*\+\s*\1\.getDueOn\(\s*\)\s*;
Assign and report the due date
---rule
catch\s*\(\s*TaskTakenException\s+e\s*\)\s*\{\s*return\s+"Unavailable: "\s*\+\s*e\.getMessage\(\s*\)\s*;
Specific catch first
---rule
catch\s*\(\s*TaskboardException\s+e\s*\)\s*\{\s*return\s+"Refused: "\s*\+\s*e\.getMessage\(\s*\)\s*;
General Taskboard catch
---rule
TaskTakenException\s+e[\s\S]*TaskboardException\s+e
Specific before general
---solution
import java.time.LocalDate;

public class Kiosk {
    static String tryAssign(Planner planner, Task task, Member member, LocalDate today) {
        try {
            Assignment assignment = planner.assign(task, member, today);
            return "Due " + assignment.getDueOn();
        } catch (TaskTakenException e) {
            return "Unavailable: " + e.getMessage();
        } catch (TaskboardException e) {
            return "Refused: " + e.getMessage();
        }
    }
}
:::
