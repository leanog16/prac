---
id: java-streams
title: Lambdas, streams & Optional
summary: Functional interfaces and lambdas, method references, the Stream pipeline (filter, map, sorted, limit, collect), collectors for grouping, counting and joining, reductions, Optional for values that might be missing, and when a plain loop is clearer.
minutes: 40
---
> [!project] Taskboard, step 9: reports in a few lines
> The team leads want reports: overdue assignments sorted by due date, tasks per assignee, total credits owed, the most-picked-up titles. Streams express each of those as a short pipeline that reads like the question.

## Lambdas: behaviour as a value

A **lambda** is a short anonymous function. It can be passed wherever a **functional interface** (an interface with exactly one abstract method) is expected:

```java
Predicate<Task> isAvailable = b -> b.isAvailable();       // Task → boolean
Function<Task, String> title = b -> b.getTitle();         // Task → String
Comparator<Task> byYear = (a, b) -> Integer.compare(a.getPoints(), b.getPoints());
Runnable hello = () -> System.out.println("hi");          // nothing → nothing
```

**Method references** are even shorter when the lambda just calls one method: `Task::isAvailable`, `Task::getTitle`, `System.out::println`.

| Functional interface | Shape | Example |
|---|---|---|
| `Predicate<T>` | T → boolean | `b -> b.getPoints() < 1900` |
| `Function<T, R>` | T → R | `Task::getAssignee` |
| `Consumer<T>` | T → nothing | `System.out::println` |
| `Supplier<T>` | nothing → T | `ArrayList::new` |
| `Comparator<T>` | (T, T) → int | `Comparator.comparing(Task::getTitle)` |

> [!plain] In plain English
> A lambda is a little piece of code you hand to another method: "here's how to test a task", "here's how to turn a task into a title".

## The stream pipeline

```java
List<String> oldTitles = tasks.stream()           // 1. source
    .filter(b -> b.getPoints() < 1900)              // 2. intermediate operations…
    .sorted(Comparator.comparing(Task::getPoints))
    .map(Task::getTitle)
    .limit(5)
    .toList();                                    // 3. terminal operation
```

Read it top to bottom as a sentence: "from the tasks, keep those before 1900, sort by points, take their titles, at most five, into a list".

- **Intermediate** operations (`filter`, `map`, `sorted`, `distinct`, `limit`) return a new stream and are **lazy**: nothing happens until a terminal operation runs.
- **Terminal** operations (`toList`, `collect`, `count`, `forEach`, `anyMatch`, `findFirst`, `reduce`) produce the result.
- Stream operations do not themselves change the source collection, though your lambdas can mutate objects or external state; avoid those side effects. A stream can only be used **once**.

## Collectors: grouping and summarizing

```java
Map<String, List<Task>> byAssignee = tasks.stream()
    .collect(Collectors.groupingBy(Task::getAssignee));

Map<String, Long> countByAssignee = tasks.stream()
    .collect(Collectors.groupingBy(Task::getAssignee, Collectors.counting()));

String titles = tasks.stream()
    .map(Task::getTitle)
    .collect(Collectors.joining(", "));            // "Write API, Fix login, Ship v1"

BigDecimal totalCredits = assignments.stream()
    .map(l -> l.creditOn(today))
    .reduce(BigDecimal.ZERO, BigDecimal::add);     // sum BigDecimals

double avgYear = tasks.stream().mapToInt(Task::getPoints).average().orElse(0);
```

This is the same idea as SQL's `GROUP BY` and Bash's `sort | uniq -c`, inside Java.

## Optional: "there might not be one"

```java
Optional<Task> first = tasks.stream()
    .filter(b -> b.getAssignee().equals("Ben"))
    .findFirst();

String title = first.map(Task::getTitle).orElse("(none)");
Task b = first.orElseThrow(() -> new TaskNotFoundException("No Ben in stock"));
first.ifPresent(task -> System.out.println(task.getTitle()));
```

`Optional` makes "might be missing" part of the **type**, so callers can't forget to handle it the way they forget to check for `null`. Use it as a **return type**. Don't use it for fields or parameters, and never call `.get()` without checking (use `orElse`, `orElseThrow`, `map`).

## Streams or loops?

Streams shine for **transform/filter/aggregate** questions. Plain loops are clearer when you need early exits with complex conditions, multiple accumulators updated together, or checked exceptions in the body. Use whichever reads better; correctness and clarity beat cleverness.

> [!mistake] Side effects inside streams
> `stream().forEach(b -> list.add(b))` or modifying shared state in `map` defeats the purpose and breaks with parallel streams. Collect results with `toList()` or a collector instead.

:::quiz
q: What does `tasks.stream().filter(...).map(...)` do without a terminal operation?
+ nothing yet: intermediate operations are lazy
- filters and maps the tasks immediately
- throws an exception
- modifies the tasks list
why: Work happens only when a terminal operation pulls elements through.
:::

:::quiz
q: Which collector counts tasks per assignee?
- Collectors.toMap(Task::getAssignee, 1)
+ Collectors.groupingBy(Task::getAssignee, Collectors.counting())
- Collectors.joining(Task::getAssignee)
- Collectors.counting(Task::getAssignee)
why: groupingBy with a downstream counting collector.
:::

:::quiz
q: What's the safe way to get a value out of an Optional<Task> that may be empty?
- opt.get()
+ opt.orElse(defaultTask) or opt.orElseThrow(...)
- (Task) opt
- opt.value
why: get() throws NoSuchElementException when empty; orElse/orElseThrow make the empty case explicit.
:::

:::quiz
q: `Task::getTitle` is equivalent to which lambda?
+ `b -> b.getTitle()`
- `() -> getTitle()`
- `(a, b) -> a.getTitle()`
- `b -> Task.getTitle(b)` only for static methods
why: An unbound instance method reference takes the object as its parameter.
:::

:::exercise
id: js-titles
level: 2
title: Available titles, sorted
mode: code
lang: java
file: Reports.java
---
Write `static List<String> availableTitles(List<Task> tasks)` returning the titles of available tasks, sorted alphabetically, using a stream with `filter(Task::isAvailable)`, `map(Task::getTitle)`, `sorted()` and `toList()`.
---starter
import java.util.List;

public class Reports {
}
---rule
static\s+List<String>\s+availableTitles\(\s*List<Task>\s+tasks\s*\)
The signature
---rule
tasks\.stream\(\s*\)
Start a stream
---rule
\.filter\(\s*(Task::isAvailable|(\w+)\s*->\s*\2\.isAvailable\(\s*\))\s*\)
Keep available tasks
---rule
\.map\(\s*(Task::getTitle|(\w+)\s*->\s*\2\.getTitle\(\s*\))\s*\)
Map to titles
---rule
\.sorted\(\s*\)
Sort
---rule
\.toList\(\s*\)|\.collect\(\s*Collectors\.toList\(\s*\)\s*\)
Collect to a list
---rule
filter[\s\S]*map[\s\S]*sorted
Filter, map, then sort
---solution
import java.util.List;

public class Reports {
    static List<String> availableTitles(List<Task> tasks) {
        return tasks.stream()
                .filter(Task::isAvailable)
                .map(Task::getTitle)
                .sorted()
                .toList();
    }
}
:::

:::exercise
id: js-group
level: 3
title: Tasks per assignee
mode: code
lang: java
file: Reports.java
---
Write `static Map<String, Long> countByAssignee(List<Task> tasks)` using `Collectors.groupingBy(Task::getAssignee, Collectors.counting())`.
---starter
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class Reports {
}
---rule
static\s+Map<String,\s*Long>\s+countByAssignee\(\s*List<Task>\s+tasks\s*\)
The signature
---rule
tasks\.stream\(\s*\)\s*\.collect\(\s*Collectors\.groupingBy\(\s*Task::getAssignee\s*,\s*Collectors\.counting\(\s*\)\s*\)\s*\)
groupingBy with counting
---solution
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class Reports {
    static Map<String, Long> countByAssignee(List<Task> tasks) {
        return tasks.stream().collect(Collectors.groupingBy(Task::getAssignee, Collectors.counting()));
    }
}
:::

:::exercise
id: js-optional
level: 2
title: Find or explain
mode: code
lang: java
file: Board.java
---
Write `static String titleOrNone(List<Task> tasks, String key)` that finds the first task with that key (`filter(b -> b.getKey().equals(key)).findFirst()`), and returns its title, or `"(not in board)"` using `map` and `orElse`.
---starter
import java.util.List;

public class Board {
}
---rule
static\s+String\s+titleOrNone\(\s*List<Task>\s+tasks\s*,\s*String\s+key\s*\)
The signature
---rule
\.filter\(\s*(\w+)\s*->\s*\1\.getKey\(\s*\)\.equals\(\s*key\s*\)\s*\)
Filter by key with `equals`
---rule
\.findFirst\(\s*\)
`findFirst()`
---rule
\.map\(\s*(Task::getTitle|(\w+)\s*->\s*\2\.getTitle\(\s*\))\s*\)
Map to the title
---rule
\.orElse\(\s*"\(not in board\)"\s*\)
Fallback with `orElse`
---rule
!\.get\(\s*\)
No bare `get()`
---solution
import java.util.List;

public class Board {
    static String titleOrNone(List<Task> tasks, String key) {
        return tasks.stream()
                .filter(b -> b.getKey().equals(key))
                .findFirst()
                .map(Task::getTitle)
                .orElse("(not in board)");
    }
}
:::

:::exercise
id: js-predict-lazy
level: 3
title: Predict: laziness
mode: answer
---
```java
List<Integer> nums = List.of(1, 2, 3, 4, 5, 6);
long n = nums.stream()
    .filter(x -> x % 2 == 0)
    .map(x -> x * 10)
    .count();
System.out.println(n);
```

What does it print?
---answer
3
---solution
3
:::

:::exercise
id: js-predict-joining
level: 2
title: Predict: joining
mode: answer
---
```java
System.out.println(Stream.of("Write API", "Fix login", "Ship v1")
    .filter(t -> t.length() == 9)
    .map(String::toUpperCase)
    .collect(Collectors.joining("|")));
```

What does it print?
---answer
WRITE API|FIX LOGIN
---solution
WRITE API|FIX LOGIN
:::

:::exercise
id: proj-java-09-overdue
level: 3
title: "Project 9: the overdue report"
mode: code
lang: java
file: AssignmentReports.java
path: java/src/main/java/taskboard/AssignmentReports.java
---
Write `static List<Assignment> overdue(List<Assignment> assignments, LocalDate today)` returning the assignments where `isOverdue(today)` is true, sorted by `getDueOn()` (oldest first), using `filter`, `sorted(Comparator.comparing(Assignment::getDueOn))` and `toList()`.
---starter
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;

public class AssignmentReports {
}
---rule
static\s+List<Assignment>\s+overdue\(\s*List<Assignment>\s+assignments\s*,\s*LocalDate\s+today\s*\)
The signature
---rule
\.filter\(\s*(\w+)\s*->\s*\1\.isOverdue\(\s*today\s*\)\s*\)
Keep overdue assignments
---rule
\.sorted\(\s*Comparator\.comparing\(\s*Assignment::getDueOn\s*\)\s*\)
Oldest due date first
---rule
\.toList\(\s*\)|\.collect\(\s*Collectors\.toList\(\s*\)\s*\)
Collect
---solution
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;

public class AssignmentReports {
    static List<Assignment> overdue(List<Assignment> assignments, LocalDate today) {
        return assignments.stream()
                .filter(l -> l.isOverdue(today))
                .sorted(Comparator.comparing(Assignment::getDueOn))
                .toList();
    }
}
:::

:::exercise
id: proj-java-09-fees
level: 4
title: "Project 9b: credits owed per member"
mode: code
lang: java
file: AssignmentReports.java
path: java/src/main/java/taskboard/AssignmentReports.java
---
Write `static Map<String, BigDecimal> creditsByMember(List<Assignment> assignments, LocalDate today, CreditPolicy policy)`: group overdue assignments by `l.getMember().getName()` and sum `policy.creditFor(ChronoUnit.DAYS.between(l.getDueOn(), today))` per member, using `Collectors.groupingBy(…, Collectors.reducing(BigDecimal.ZERO, …, BigDecimal::add))`.
---starter
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class AssignmentReports {
}
---rule
static\s+Map<String,\s*BigDecimal>\s+creditsByMember\(\s*List<Assignment>\s+assignments\s*,\s*LocalDate\s+today\s*,\s*CreditPolicy\s+policy\s*\)
The signature
---rule
\.filter\(\s*(\w+)\s*->\s*\1\.isOverdue\(\s*today\s*\)\s*\)
Only overdue assignments
---rule
Collectors\.groupingBy\(\s*(\w+)\s*->\s*\1\.getMember\(\s*\)\.getName\(\s*\)
Group by member name
---rule
Collectors\.reducing\(\s*BigDecimal\.ZERO\s*,
Reduce from zero
---rule
policy\.creditFor\(\s*ChronoUnit\.DAYS\.between\(\s*\w+\.getDueOn\(\s*\)\s*,\s*today\s*\)\s*\)
Credit for the late days
---rule
BigDecimal::add
Sum with `BigDecimal::add`
---solution
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class AssignmentReports {
    static Map<String, BigDecimal> creditsByMember(List<Assignment> assignments, LocalDate today, CreditPolicy policy) {
        return assignments.stream()
                .filter(l -> l.isOverdue(today))
                .collect(Collectors.groupingBy(
                        l -> l.getMember().getName(),
                        Collectors.reducing(BigDecimal.ZERO,
                                l -> policy.creditFor(ChronoUnit.DAYS.between(l.getDueOn(), today)),
                                BigDecimal::add)));
    }
}
:::
