---
id: java-polymorphism
title: Polymorphism
summary: Static vs dynamic types, dynamic dispatch, upcasting and downcasting, instanceof pattern matching, replacing type checks with overriding, sealed interfaces and exhaustive switch patterns, overloading vs overriding, and the Liskov substitution principle.
minutes: 40
---
> [!project] Taskboard, step 6: one loop for every item
> The team's standup report goes through **every** item and prints its description, assignment period and credit rule. With polymorphism, that report is one short loop that never mentions `Task`, `Bug` or `Milestone`, and keeps working when someone adds `Subtask` next year.

## One call, many behaviours

```java
List<WorkItem> items = List.of(
    new Task("TB-101", "Write API", "Ana"),
    new Bug("B-001", "Login crash", 2),
    new Milestone("M-042", "Beta launch", 4)
);

for (WorkItem item : items) {
    System.out.println(item.describe());
}
```

```
Write API by Ana
Login crash (bug, severity 2)
Beta launch (sprint 4)
```

The loop calls `describe()` on a `WorkItem` variable, yet three different methods run. This is **polymorphism** ("many forms").

## Static type vs dynamic type

```java
WorkItem item = new Bug("B-001", "Login crash", 2);
```

| | |
|---|---|
| **static type** (of the variable) | `WorkItem`: decides which methods you're **allowed to call**, checked by the compiler |
| **dynamic type** (of the object) | `Bug`: decides which implementation **actually runs**, chosen at runtime |

So `item.describe()` compiles because `WorkItem` declares it, and runs `Bug`'s version because the object is a `Bug`. This runtime choice is **dynamic dispatch**. But `item.getSeverity()` doesn't compile: the compiler only knows it's a `WorkItem`.

> [!plain] In plain English
> The variable's type is the label on the box; the object's type is what's inside. The compiler reads the label to decide what you may ask for; at runtime, the thing inside answers in its own way.

## Upcasting and downcasting

- **Upcasting** (`Bug` → `WorkItem`) is automatic and always safe: every bug is an item.
- **Downcasting** (`WorkItem` → `Bug`) needs a cast and can fail at runtime with `ClassCastException`. Check first, and let pattern matching do the cast:

```java
if (item instanceof Bug bug) {            // test and bind in one step (Java 16+)
    System.out.println(bug.getSeverity());
}
```

## Replace type checks with overriding

This code is a classic smell:

```java
int targetDays(WorkItem item) {
    if (item instanceof Bug) return 7;
    if (item instanceof Task) return 21;
    if (item instanceof Milestone) return 0;
    return 14;
}
```

Every new item type means finding and editing every one of these `if` chains, and missing one is a silent bug. Move the decision **into the classes**: `item.targetDays()`, each class overriding it. Then adding `Subtask` means writing one class; no existing code changes. That's the **Open/Closed Principle**: open for extension, closed for modification.

## Sealed types and exhaustive switches

Sometimes a closed set of variants is exactly right, and you *want* to handle each in one place (like a credit report that's not the items' responsibility). Java 17+ lets you **seal** the hierarchy, and Java 21 lets `switch` match types exhaustively:

```java
public sealed interface Item permits Task, Bug, Milestone {}

String columnLabel(Item item) {
    return switch (item) {
        case Task b     -> "B-" + b.getTitle();
        case Bug d      -> "D-" + d.getTitle();
        case Milestone m -> "M-" + m.getTitle();
    };                                         // no default needed: the compiler knows all cases
}
```

Add a fourth permitted type, and every such `switch` **fails to compile** until it handles it. You get the safety of overriding, with the logic kept in one place.

## Overloading is not overriding

| | Overloading | Overriding |
|---|---|---|
| what | same name, **different parameters**, often in the same class | same signature in a **subclass** |
| chosen | at **compile time**, from the static types of the arguments | at **runtime**, from the object's dynamic type |
| example | `print(Task b)` and `print(Bug d)` | `Bug.describe()` replacing `WorkItem.describe()` |

```java
void print(WorkItem i) { System.out.println("item"); }
void print(Bug d)         { System.out.println("bug"); }

WorkItem x = new Bug("B-1", "Login crash", 2);
print(x);          // prints "item": overloads are picked by the STATIC type
```

## The Liskov substitution principle

A subclass must work **anywhere its parent is expected**, without surprising the caller. Lesson 4's `Milestone.pickUp()` throwing `UnsupportedOperationException` violated that: code written against `WorkItem` reasonably expects `pickUp()` to work. The interface split in lesson 5 (`Assignable` only on things that can be taken) fixed it. When a subclass has to disable or weaken a parent's method, the hierarchy is wrong.

:::quiz
q: `WorkItem i = new Bug(...); i.describe();` — whose `describe()` runs?
- WorkItem's, because of the variable type
+ Bug's, because of the object's runtime type
- neither; it doesn't compile
- both
why: Overridden methods are dispatched dynamically.
:::

:::quiz
q: Why does `i.getSeverity()` (a Bug-only method) not compile when `i` is declared as `WorkItem`?
+ the compiler only allows methods of the static type
- getSeverity is private
- Bug isn't a WorkItem
- because of dynamic dispatch
why: The static type decides what you may call.
:::

:::quiz
q: Overloaded methods `print(WorkItem)` and `print(Bug)` exist. `WorkItem x = new Bug(...); print(x);` calls…
+ print(WorkItem): overloads are resolved at compile time from static types
- print(Bug)
- both
- neither
why: Only overriding is dynamic; overloading isn't.
:::

:::quiz
q: What does a sealed interface plus a switch over its permitted types give you?
+ the compiler checks the switch handles every subtype, and fails when a new one is added
- faster code
- the ability to extend from any package
- runtime type checks
why: Exhaustiveness checking turns forgotten cases into compile errors.
:::

:::exercise
id: jp-pattern
level: 2
title: Pattern matching instanceof
mode: code
lang: java
file: Report.java
---
Write `static String severity(WorkItem item)` that returns `"severity " + bug.getSeverity()` when the item is a `Bug` (use `instanceof Bug bug`), and `"n/a"` otherwise.
---starter
public class Report {
}
---rule
static\s+String\s+severity\(\s*WorkItem\s+item\s*\)
The signature
---rule
if\s*\(\s*item\s+instanceof\s+Bug\s+bug\s*\)
Pattern-matching `instanceof`
---rule
return\s+"severity "\s*\+\s*bug\.getSeverity\(\s*\)\s*;
Use the bound variable
---rule
return\s+"n/a"\s*;
Fallback
---rule
!\(\s*Bug\s*\)\s*item
No manual cast
---solution
public class Report {
    static String severity(WorkItem item) {
        if (item instanceof Bug bug) {
            return "severity " + bug.getSeverity();
        }
        return "n/a";
    }
}
:::

:::exercise
id: jp-sealed
level: 3
title: An exhaustive switch
mode: code
lang: java
file: Shelves.java
---
Given `sealed interface Item permits Task, Bug, Milestone`, write `static String column(Item item)` returning a **switch expression** with type patterns: `Task b` → `"Tasks"`, `Bug d` → `"Bugs"`, `Milestone m` → `"Milestones"`. No `default`.
---starter
public class Shelves {
}
---rule
static\s+String\s+column\(\s*Item\s+item\s*\)
The signature
---rule
return\s+switch\s*\(\s*item\s*\)
A switch expression
---rule
case\s+Task\s+\w+\s*->\s*"Tasks"
Task
---rule
case\s+Bug\s+\w+\s*->\s*"Bugs"
Bug
---rule
case\s+Milestone\s+\w+\s*->\s*"Milestones"
Milestone
---rule
!default
No default: exhaustive
---solution
public class Shelves {
    static String column(Item item) {
        return switch (item) {
            case Task b -> "Tasks";
            case Bug d -> "Bugs";
            case Milestone m -> "Milestones";
        };
    }
}
:::

:::exercise
id: jp-predict-overload
level: 3
title: Predict: overload or override?
mode: answer
---
```java
class Item { String kind() { return "item"; } }
class Bug extends Item { @Override String kind() { return "bug"; } }

static String label(Item i) { return "I:" + i.kind(); }
static String label(Bug d)  { return "D:" + d.kind(); }

Item x = new Bug();
System.out.println(label(x));
```

What does it print?
---answer
I:bug
---solution
I:bug
---explain
The **overload** is chosen at compile time from the static type `Item` → `label(Item)`. Inside it, `i.kind()` is **overridden**, so the Bug version runs at runtime.
:::

:::exercise
id: jp-predict-loop
level: 2
title: Predict: a polymorphic loop
mode: answer
---
`Task.targetDays()` returns 21, `Bug.targetDays()` returns 7. What does this print?

```java
List<Assignable> items = List.of(new Task(...), new Bug(...), new Bug(...));
int total = 0;
for (Assignable b : items) total += b.targetDays();
System.out.println(total);
```
---answer
35
---solution
35
:::

:::exercise
id: proj-java-06-refactor
level: 3
title: "Project 6: kill the instanceof chain"
mode: code
lang: java
file: Planner.java
path: java/src/main/java/taskboard/Planner.java
---
`dueDate` decides the assignment period with an `instanceof` chain. Rewrite it to take an `Assignable item` and return `today.plusDays(item.targetDays())`, so each class decides its own period.
---starter
import java.time.LocalDate;

public class Planner {
    static LocalDate dueDate(WorkItem item, LocalDate today) {
        if (item instanceof Bug) return today.plusDays(7);
        if (item instanceof Task) return today.plusDays(21);
        return today.plusDays(14);
    }
}
---rule
static\s+LocalDate\s+dueDate\(\s*Assignable\s+item\s*,\s*LocalDate\s+today\s*\)
Takes an `Assignable`
---rule
return\s+today\.plusDays\(\s*item\.targetDays\(\s*\)\s*\)\s*;
Ask the item
---rule
!instanceof
No type checks
---solution
import java.time.LocalDate;

public class Planner {
    static LocalDate dueDate(Assignable item, LocalDate today) {
        return today.plusDays(item.targetDays());
    }
}
:::

:::exercise
id: proj-java-06-report
level: 3
title: "Project 6b: the standup report"
mode: code
lang: java
file: StandupReport.java
path: java/src/main/java/taskboard/StandupReport.java
---
Write `static List<String> lines(List<? extends WorkItem> items)` that returns one line per item: `item.describe()`, followed by `" - assign " + b.targetDays() + " days"` when the item is `Assignable b`, or `" - not assignable"` otherwise. Build the result in an `ArrayList`.
---starter
import java.util.ArrayList;
import java.util.List;

public class StandupReport {
}
---rule
static\s+List<String>\s+lines\(\s*List<\?\s+extends\s+WorkItem>\s+items\s*\)
The signature
---rule
List<String>\s+\w+\s*=\s*new\s+ArrayList<>\(\s*\)
An `ArrayList` for the result
---rule
for\s*\(\s*WorkItem\s+(\w+)\s*:\s*items\s*\)
Loop over the items
---rule
instanceof\s+Assignable\s+b
Pattern-match `Assignable`
---rule
"\s*-\s*assign "\s*\+\s*b\.targetDays\(\s*\)\s*\+\s*" days"
Assign line
---rule
"\s*-\s*not assignable"
Reference line
---rule
\.describe\(\s*\)
Use `describe()`
---solution
import java.util.ArrayList;
import java.util.List;

public class StandupReport {
    static List<String> lines(List<? extends WorkItem> items) {
        List<String> out = new ArrayList<>();
        for (WorkItem item : items) {
            if (item instanceof Assignable b) {
                out.add(item.describe() + " - assign " + b.targetDays() + " days");
            } else {
                out.add(item.describe() + " - not assignable");
            }
        }
        return out;
    }
}
:::
