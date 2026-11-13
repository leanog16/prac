---
id: java-polymorphism
title: Polymorphism
summary: Static vs dynamic types, dynamic dispatch, upcasting and downcasting, instanceof pattern matching, replacing type checks with overriding, sealed interfaces and exhaustive switch patterns, overloading vs overriding, and the Liskov substitution principle.
minutes: 40
---
> [!project] Bookshelf, step 6: one loop for every item
> The library's overnight report goes through **every** item and prints its description, loan period and fee rule. With polymorphism, that report is one short loop that never mentions `Book`, `Dvd` or `Magazine`, and keeps working when someone adds `AudioBook` next year.

## One call, many behaviours

```java
List<LibraryItem> items = List.of(
    new Book("9780441013593", "Dune", "Frank Herbert"),
    new Dvd("D-001", "Alien", 117),
    new Magazine("M-042", "Wired", 42)
);

for (LibraryItem item : items) {
    System.out.println(item.describe());
}
```

```
Dune by Frank Herbert
Alien (DVD, 117 min)
Wired #42
```

The loop calls `describe()` on a `LibraryItem` variable, yet three different methods run. This is **polymorphism** ("many forms").

## Static type vs dynamic type

```java
LibraryItem item = new Dvd("D-001", "Alien", 117);
```

| | |
|---|---|
| **static type** (of the variable) | `LibraryItem`: decides which methods you're **allowed to call**, checked by the compiler |
| **dynamic type** (of the object) | `Dvd`: decides which implementation **actually runs**, chosen at runtime |

So `item.describe()` compiles because `LibraryItem` declares it, and runs `Dvd`'s version because the object is a `Dvd`. This runtime choice is **dynamic dispatch**. But `item.getMinutes()` doesn't compile: the compiler only knows it's a `LibraryItem`.

> [!plain] In plain English
> The variable's type is the label on the box; the object's type is what's inside. The compiler reads the label to decide what you may ask for; at runtime, the thing inside answers in its own way.

## Upcasting and downcasting

- **Upcasting** (`Dvd` → `LibraryItem`) is automatic and always safe: every DVD is an item.
- **Downcasting** (`LibraryItem` → `Dvd`) needs a cast and can fail at runtime with `ClassCastException`. Check first, and let pattern matching do the cast:

```java
if (item instanceof Dvd dvd) {            // test and bind in one step (Java 16+)
    System.out.println(dvd.getMinutes());
}
```

## Replace type checks with overriding

This code is a classic smell:

```java
int loanDays(LibraryItem item) {
    if (item instanceof Dvd) return 7;
    if (item instanceof Book) return 21;
    if (item instanceof Magazine) return 0;
    return 14;
}
```

Every new item type means finding and editing every one of these `if` chains, and missing one is a silent bug. Move the decision **into the classes**: `item.loanDays()`, each class overriding it. Then adding `AudioBook` means writing one class; no existing code changes. That's the **Open/Closed Principle**: open for extension, closed for modification.

## Sealed types and exhaustive switches

Sometimes a closed set of variants is exactly right, and you *want* to handle each in one place (like a fee report that's not the items' responsibility). Java 17+ lets you **seal** the hierarchy, and Java 21 lets `switch` match types exhaustively:

```java
public sealed interface Item permits Book, Dvd, Magazine {}

String shelfLabel(Item item) {
    return switch (item) {
        case Book b     -> "B-" + b.getTitle();
        case Dvd d      -> "D-" + d.getTitle();
        case Magazine m -> "M-" + m.getTitle();
    };                                         // no default needed: the compiler knows all cases
}
```

Add a fourth permitted type, and every such `switch` **fails to compile** until it handles it. You get the safety of overriding, with the logic kept in one place.

## Overloading is not overriding

| | Overloading | Overriding |
|---|---|---|
| what | same name, **different parameters**, often in the same class | same signature in a **subclass** |
| chosen | at **compile time**, from the static types of the arguments | at **runtime**, from the object's dynamic type |
| example | `print(Book b)` and `print(Dvd d)` | `Dvd.describe()` replacing `LibraryItem.describe()` |

```java
void print(LibraryItem i) { System.out.println("item"); }
void print(Dvd d)         { System.out.println("dvd"); }

LibraryItem x = new Dvd("D-1", "Alien", 117);
print(x);          // prints "item": overloads are picked by the STATIC type
```

## The Liskov substitution principle

A subclass must work **anywhere its parent is expected**, without surprising the caller. Lesson 4's `Magazine.borrow()` throwing `UnsupportedOperationException` violated that: code written against `LibraryItem` reasonably expects `borrow()` to work. The interface split in lesson 5 (`Borrowable` only on things that can be borrowed) fixed it. When a subclass has to disable or weaken a parent's method, the hierarchy is wrong.

:::quiz
q: `LibraryItem i = new Dvd(...); i.describe();` — whose `describe()` runs?
- LibraryItem's, because of the variable type
+ Dvd's, because of the object's runtime type
- neither; it doesn't compile
- both
why: Overridden methods are dispatched dynamically.
:::

:::quiz
q: Why does `i.getMinutes()` (a Dvd-only method) not compile when `i` is declared as `LibraryItem`?
+ the compiler only allows methods of the static type
- getMinutes is private
- Dvd isn't a LibraryItem
- because of dynamic dispatch
why: The static type decides what you may call.
:::

:::quiz
q: Overloaded methods `print(LibraryItem)` and `print(Dvd)` exist. `LibraryItem x = new Dvd(...); print(x);` calls…
+ print(LibraryItem): overloads are resolved at compile time from static types
- print(Dvd)
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
Write `static String runtime(LibraryItem item)` that returns `dvd.getMinutes() + " min"` when the item is a `Dvd` (use `instanceof Dvd dvd`), and `"n/a"` otherwise.
---starter
public class Report {
}
---rule
static\s+String\s+runtime\(\s*LibraryItem\s+item\s*\)
The signature
---rule
if\s*\(\s*item\s+instanceof\s+Dvd\s+dvd\s*\)
Pattern-matching `instanceof`
---rule
return\s+dvd\.getMinutes\(\s*\)\s*\+\s*" min"\s*;
Use the bound variable
---rule
return\s+"n/a"\s*;
Fallback
---rule
!\(\s*Dvd\s*\)\s*item
No manual cast
---solution
public class Report {
    static String runtime(LibraryItem item) {
        if (item instanceof Dvd dvd) {
            return dvd.getMinutes() + " min";
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
Given `sealed interface Item permits Book, Dvd, Magazine`, write `static String shelf(Item item)` returning a **switch expression** with type patterns: `Book b` → `"Stacks"`, `Dvd d` → `"Media"`, `Magazine m` → `"Periodicals"`. No `default`.
---starter
public class Shelves {
}
---rule
static\s+String\s+shelf\(\s*Item\s+item\s*\)
The signature
---rule
return\s+switch\s*\(\s*item\s*\)
A switch expression
---rule
case\s+Book\s+\w+\s*->\s*"Stacks"
Book
---rule
case\s+Dvd\s+\w+\s*->\s*"Media"
Dvd
---rule
case\s+Magazine\s+\w+\s*->\s*"Periodicals"
Magazine
---rule
!default
No default: exhaustive
---solution
public class Shelves {
    static String shelf(Item item) {
        return switch (item) {
            case Book b -> "Stacks";
            case Dvd d -> "Media";
            case Magazine m -> "Periodicals";
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
class Dvd extends Item { @Override String kind() { return "dvd"; } }

static String label(Item i) { return "I:" + i.kind(); }
static String label(Dvd d)  { return "D:" + d.kind(); }

Item x = new Dvd();
System.out.println(label(x));
```

What does it print?
---answer
I:dvd
---solution
I:dvd
---explain
The **overload** is chosen at compile time from the static type `Item` → `label(Item)`. Inside it, `i.kind()` is **overridden**, so the Dvd version runs at runtime.
:::

:::exercise
id: jp-predict-loop
level: 2
title: Predict: a polymorphic loop
mode: answer
---
`Book.loanDays()` returns 21, `Dvd.loanDays()` returns 7. What does this print?

```java
List<Borrowable> items = List.of(new Book(...), new Dvd(...), new Dvd(...));
int total = 0;
for (Borrowable b : items) total += b.loanDays();
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
file: LoanDesk.java
---
`dueDate` decides the loan period with an `instanceof` chain. Rewrite it to take a `Borrowable item` and return `today.plusDays(item.loanDays())`, so each class decides its own period.
---starter
import java.time.LocalDate;

public class LoanDesk {
    static LocalDate dueDate(LibraryItem item, LocalDate today) {
        if (item instanceof Dvd) return today.plusDays(7);
        if (item instanceof Book) return today.plusDays(21);
        return today.plusDays(14);
    }
}
---rule
static\s+LocalDate\s+dueDate\(\s*Borrowable\s+item\s*,\s*LocalDate\s+today\s*\)
Takes a `Borrowable`
---rule
return\s+today\.plusDays\(\s*item\.loanDays\(\s*\)\s*\)\s*;
Ask the item
---rule
!instanceof
No type checks
---solution
import java.time.LocalDate;

public class LoanDesk {
    static LocalDate dueDate(Borrowable item, LocalDate today) {
        return today.plusDays(item.loanDays());
    }
}
:::

:::exercise
id: proj-java-06-report
level: 3
title: "Project 6b: the overnight report"
mode: code
lang: java
file: OvernightReport.java
---
Write `static List<String> lines(List<? extends LibraryItem> items)` that returns one line per item: `item.describe()`, followed by `" - lend " + b.loanDays() + " days"` when the item is `Borrowable b`, or `" - reference only"` otherwise. Build the result in an `ArrayList`.
---starter
import java.util.ArrayList;
import java.util.List;

public class OvernightReport {
}
---rule
static\s+List<String>\s+lines\(\s*List<\?\s+extends\s+LibraryItem>\s+items\s*\)
The signature
---rule
List<String>\s+\w+\s*=\s*new\s+ArrayList<>\(\s*\)
An `ArrayList` for the result
---rule
for\s*\(\s*LibraryItem\s+(\w+)\s*:\s*items\s*\)
Loop over the items
---rule
instanceof\s+Borrowable\s+b
Pattern-match `Borrowable`
---rule
"\s*-\s*lend "\s*\+\s*b\.loanDays\(\s*\)\s*\+\s*" days"
Lend line
---rule
"\s*-\s*reference only"
Reference line
---rule
\.describe\(\s*\)
Use `describe()`
---solution
import java.util.ArrayList;
import java.util.List;

public class OvernightReport {
    static List<String> lines(List<? extends LibraryItem> items) {
        List<String> out = new ArrayList<>();
        for (LibraryItem item : items) {
            if (item instanceof Borrowable b) {
                out.add(item.describe() + " - lend " + b.loanDays() + " days");
            } else {
                out.add(item.describe() + " - reference only");
            }
        }
        return out;
    }
}
:::
