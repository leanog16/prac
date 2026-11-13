---
id: java-inheritance
title: Inheritance
summary: Extending a class, what is and isn't inherited, super constructors and super method calls, overriding with @Override, protected members, the Object class and its equals/hashCode/toString contract, final classes and methods, and when inheritance is the wrong tool.
minutes: 40
---
> [!project] Bookshelf, step 4: more than books
> The library also lends DVDs and magazines. They share a lot with books (an id, a title, availability, borrowing), but each has its own details and rules: DVDs have a runtime and a shorter loan period; magazines can't be borrowed at all. Inheritance lets them share what's common.

## Extracting what's common

```java
public class LibraryItem {
    private final String id;
    private final String title;
    private boolean available = true;

    public LibraryItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    public String getId() { return id; }
    public String getTitle() { return title; }
    public boolean isAvailable() { return available; }

    public void borrow() {
        if (!available) throw new IllegalStateException(title + " is already borrowed");
        available = false;
    }

    public void giveBack() { available = true; }

    public int loanDays() { return 21; }

    public String describe() { return title; }
}
```

```java
public class Book extends LibraryItem {
    private final String author;

    public Book(String isbn, String title, String author) {
        super(isbn, title);                 // must be the first statement
        this.author = author;
    }

    @Override
    public String describe() {
        return getTitle() + " by " + author;
    }
}

public class Dvd extends LibraryItem {
    private final int minutes;

    public Dvd(String id, String title, int minutes) {
        super(id, title);
        this.minutes = minutes;
    }

    @Override
    public int loanDays() { return 7; }

    @Override
    public String describe() {
        return getTitle() + " (DVD, " + minutes + " min)";
    }
}
```

`Book` and `Dvd` **are** `LibraryItem`s: they inherit `getId()`, `borrow()`, `isAvailable()` and the rest, and **override** what's different.

> [!plain] In plain English
> `class Dvd extends LibraryItem` means "a DVD is a kind of library item: it has everything an item has, plus or instead of a few things".

## What a subclass gets

| Inherited? | |
|---|---|
| public and protected methods and fields | yes |
| private fields | they **exist** in the object, but the subclass can't access them by name (use getters or `protected`) |
| constructors | **no**: each class declares its own and calls `super(...)` |
| static methods | they're accessible, but they're not overridden (they're "hidden") |

The `super(...)` call runs the parent's constructor first, so the parent's part of the object is initialized before the child's. If you don't write one, Java inserts `super()`, which fails to compile when the parent has no no-arg constructor.

## Overriding

A subclass method with the same signature **replaces** the parent's version for objects of that subclass:

- Always write `@Override`: the compiler then catches typos and signature mismatches.
- The overriding method can't be **less visible** (public stays public).
- Call the parent's version with `super.method()`:

```java
public class Magazine extends LibraryItem {
    private final int issue;

    public Magazine(String id, String title, int issue) {
        super(id, title);
        this.issue = issue;
    }

    @Override
    public void borrow() {
        throw new UnsupportedOperationException("Magazines are reference-only");
    }

    @Override
    public String describe() {
        return super.describe() + " #" + issue;      // reuse the parent's text
    }
}
```

## Object: the root of everything

Every class extends `java.lang.Object` (directly or indirectly), which provides `toString()`, `equals(Object)`, `hashCode()` and more. Overriding `equals` and `hashCode` is how you define what "the same item" means:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof LibraryItem other)) return false;
    return id.equals(other.id);
}

@Override
public int hashCode() {
    return id.hashCode();
}
```

**The contract:** if `a.equals(b)`, then `a.hashCode() == b.hashCode()`. Break it (override `equals` but not `hashCode`) and `HashSet` and `HashMap` silently misbehave: two "equal" items both end up in a set. Records generate both correctly.

## protected and final

- `protected` members are visible to subclasses (and the same package). Use them sparingly: every protected member is a promise to every future subclass.
- A `final` **method** can't be overridden; a `final` **class** can't be extended (`String` is final). Make classes `final` unless you designed them for extension.

## When not to inherit

Inheritance models **"is-a"**, and it's the tightest coupling Java has: a subclass depends on its parent's internals. Prefer **composition** ("has-a") when you only want to reuse code:

```java
// A Loan isn't a kind of Book. It *has* an item and a member.
public class Loan {
    private final LibraryItem item;
    private final Member member;
    private final LocalDate dueOn;
    // ...
}
```

The famous trap is `class Stack extends ArrayList`: the stack inherits `add(index, x)`, `remove(index)` and other methods that let callers break its last-in-first-out rule. A stack that **has** a list and exposes only `push` and `pop` is correct.

> [!mistake] Deep hierarchies
> `Item → PhysicalItem → PrintedItem → BoundItem → Book → Hardcover` is hard to understand and harder to change. Keep hierarchies shallow, one or two levels, and use interfaces (next lesson) for shared capabilities.

:::quiz
q: What must a subclass constructor do if the parent has only `LibraryItem(String id, String title)`?
+ call `super(id, title)` as its first statement
- nothing; constructors are inherited
- call `this(id, title)`
- declare the same fields again
why: Constructors aren't inherited, and the implicit super() wouldn't compile.
:::

:::quiz
q: Why write `@Override`?
- it's required for overriding to work
+ the compiler then checks the method really overrides a parent method, catching typos and wrong signatures
- it makes the method faster
- it makes the method final
why: Without it, a misspelled method silently becomes a new, unrelated method.
:::

:::quiz
q: A class overrides `equals` but not `hashCode`. What can go wrong?
+ equal objects can land in different buckets, so HashSet and HashMap treat them as different
- nothing
- it doesn't compile
- toString breaks
why: Equal objects must have equal hash codes.
:::

:::quiz
q: Which relationship should `Loan` have with `Member`?
- Loan extends Member
- Member extends Loan
+ Loan has a Member field (composition)
- none
why: A loan isn't a kind of member; it refers to one.
:::

:::exercise
id: ji-dvd
level: 2
title: A Dvd subclass
mode: code
lang: java
file: Dvd.java
---
Write `Dvd extends LibraryItem` with a `private final int minutes`, a public constructor `Dvd(String id, String title, int minutes)` that calls `super(id, title)`, and overrides (with `@Override`) of `loanDays()` returning `7` and `describe()` returning `getTitle() + " (DVD, " + minutes + " min)"`.
---starter
public class Dvd {
}
---rule
public\s+class\s+Dvd\s+extends\s+LibraryItem
`extends LibraryItem`
---rule
private\s+final\s+int\s+minutes\s*;
`private final int minutes;`
---rule
public\s+Dvd\(\s*String\s+id\s*,\s*String\s+title\s*,\s*int\s+minutes\s*\)\s*\{\s*super\(\s*id\s*,\s*title\s*\)\s*;
Constructor calls `super(id, title)` first
---rule
@Override\s*\n\s*public\s+int\s+loanDays\(\s*\)\s*\{\s*return\s+7\s*;
`loanDays()` → 7
---rule
@Override\s*\n\s*public\s+String\s+describe\(\s*\)\s*\{\s*return\s+getTitle\(\s*\)\s*\+\s*" \(DVD, "\s*\+\s*minutes\s*\+\s*" min\)"\s*;
`describe()`
---solution
public class Dvd extends LibraryItem {
    private final int minutes;

    public Dvd(String id, String title, int minutes) {
        super(id, title);
        this.minutes = minutes;
    }

    @Override
    public int loanDays() {
        return 7;
    }

    @Override
    public String describe() {
        return getTitle() + " (DVD, " + minutes + " min)";
    }
}
:::

:::exercise
id: ji-equals
level: 3
title: equals and hashCode
mode: code
lang: java
file: LibraryItem.java
---
Two `LibraryItem` objects with the same `id` are the same item. Override `equals(Object o)` (return true for `this == o`; false unless `o instanceof LibraryItem other`; otherwise compare `id`s with `equals`) and `hashCode()` (return `id.hashCode()`).
---starter
public class LibraryItem {
    private final String id;
    private final String title;

    public LibraryItem(String id, String title) {
        this.id = id;
        this.title = title;
    }
}
---rule
@Override\s*\n\s*public\s+boolean\s+equals\(\s*Object\s+o\s*\)
`@Override public boolean equals(Object o)`
---rule
if\s*\(\s*this\s*==\s*o\s*\)\s*return\s+true\s*;
Same reference → true
---rule
if\s*\(\s*!\s*\(\s*o\s+instanceof\s+LibraryItem\s+other\s*\)\s*\)\s*return\s+false\s*;
Wrong type → false
---rule
return\s+id\.equals\(\s*other\.id\s*\)\s*;
Compare ids
---rule
@Override\s*\n\s*public\s+int\s+hashCode\(\s*\)\s*\{\s*return\s+id\.hashCode\(\s*\)\s*;
`hashCode()` from the id
---solution
public class LibraryItem {
    private final String id;
    private final String title;

    public LibraryItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof LibraryItem other)) return false;
        return id.equals(other.id);
    }

    @Override
    public int hashCode() {
        return id.hashCode();
    }
}
:::

:::exercise
id: ji-predict-override
level: 2
title: Predict: which describe()?
mode: answer
---
```java
LibraryItem item = new Dvd("D1", "Alien", 117);
System.out.println(item.describe() + " / " + item.loanDays());
```

(using the `Dvd` class from the lesson) What does it print?
---answer
Alien (DVD, 117 min) / 7
---solution
Alien (DVD, 117 min) / 7
---explain
The variable's type is LibraryItem, but the object is a Dvd, and Java calls the object's overriding methods. That's polymorphism (lesson 6).
:::

:::exercise
id: ji-predict-super
level: 3
title: Predict: constructor order
mode: answer
---
```java
class A { A() { System.out.print("A"); } }
class B extends A { B() { System.out.print("B"); } }
class C extends B { C() { System.out.print("C"); } }

new C();
```

What does it print?
---answer
ABC
---solution
ABC
---explain
Each constructor implicitly calls `super()` first, so the parents finish initializing before the child's constructor body runs.
:::

:::exercise
id: proj-java-04-magazine
level: 3
title: "Project 4: reference-only magazines"
mode: code
lang: java
file: Magazine.java
---
Write `Magazine extends LibraryItem` with `private final int issue`, constructor `Magazine(String id, String title, int issue)` calling `super`, an override of `borrow()` that throws `new UnsupportedOperationException("Magazines are reference-only")`, and an override of `describe()` returning `super.describe() + " #" + issue`.
---starter
public class Magazine {
}
---rule
public\s+class\s+Magazine\s+extends\s+LibraryItem
`extends LibraryItem`
---rule
private\s+final\s+int\s+issue\s*;
`private final int issue;`
---rule
Magazine\(\s*String\s+id\s*,\s*String\s+title\s*,\s*int\s+issue\s*\)\s*\{\s*super\(\s*id\s*,\s*title\s*\)\s*;
Constructor with `super`
---rule
@Override\s*\n\s*public\s+void\s+borrow\(\s*\)\s*\{\s*throw\s+new\s+UnsupportedOperationException\(\s*"Magazines are reference-only"\s*\)\s*;
`borrow()` is refused
---rule
@Override\s*\n\s*public\s+String\s+describe\(\s*\)\s*\{\s*return\s+super\.describe\(\s*\)\s*\+\s*" #"\s*\+\s*issue\s*;
`describe()` reuses `super.describe()`
---solution
public class Magazine extends LibraryItem {
    private final int issue;

    public Magazine(String id, String title, int issue) {
        super(id, title);
        this.issue = issue;
    }

    @Override
    public void borrow() {
        throw new UnsupportedOperationException("Magazines are reference-only");
    }

    @Override
    public String describe() {
        return super.describe() + " #" + issue;
    }
}
:::

:::exercise
id: proj-java-04-loan
level: 3
title: "Project 4b: Loan uses composition"
mode: code
lang: java
file: Loan.java
---
Write an immutable `Loan` class (not a subclass of anything) with `private final` fields `LibraryItem item`, `Member member` and `LocalDate dueOn`, a public constructor taking all three, getters, and `public boolean isOverdue(LocalDate today)` returning `today.isAfter(dueOn)`.
---starter
import java.time.LocalDate;
---rule
public\s+(final\s+)?class\s+Loan\s*\{
A plain class, no `extends`
---rule
private\s+final\s+LibraryItem\s+item\s*;
Has an item
---rule
private\s+final\s+Member\s+member\s*;
Has a member
---rule
private\s+final\s+LocalDate\s+dueOn\s*;
Has a due date
---rule
public\s+Loan\(\s*LibraryItem\s+item\s*,\s*Member\s+member\s*,\s*LocalDate\s+dueOn\s*\)
The constructor
---rule
public\s+LibraryItem\s+getItem\(\s*\)[\s\S]*public\s+Member\s+getMember\(\s*\)[\s\S]*public\s+LocalDate\s+getDueOn\(\s*\)
Getters
---rule
public\s+boolean\s+isOverdue\(\s*LocalDate\s+today\s*\)\s*\{\s*return\s+today\.isAfter\(\s*dueOn\s*\)\s*;
`isOverdue(today)`
---solution
import java.time.LocalDate;

public final class Loan {
    private final LibraryItem item;
    private final Member member;
    private final LocalDate dueOn;

    public Loan(LibraryItem item, Member member, LocalDate dueOn) {
        this.item = item;
        this.member = member;
        this.dueOn = dueOn;
    }

    public LibraryItem getItem() { return item; }
    public Member getMember() { return member; }
    public LocalDate getDueOn() { return dueOn; }

    public boolean isOverdue(LocalDate today) {
        return today.isAfter(dueOn);
    }
}
:::
