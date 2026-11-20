---
id: java-inheritance
title: Inheritance
summary: Extending a class, what is and isn't inherited, super constructors and super method calls, overriding with @Override, protected members, the Object class and its equals/hashCode/toString contract, final classes and methods, and when inheritance is the wrong tool.
minutes: 40
---
> [!project] Taskboard, step 4: more than tasks
> The team also assigns bugs and milestones. They share a lot with tasks (an id, a title, availability, picking up), but each has its own details and rules: bugs have a severity and a shorter target time; milestones mark a point in a sprint and can't be picked up by anyone. Inheritance lets them share what's common.

## Extracting what's common

```java
public class WorkItem {
    private final String id;
    private final String title;
    private boolean available = true;

    public WorkItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    public String getId() { return id; }
    public String getTitle() { return title; }
    public boolean isAvailable() { return available; }

    public void pickUp() {
        if (!available) throw new IllegalStateException(title + " is already taken");
        available = false;
    }

    public void putBack() { available = true; }

    public int targetDays() { return 21; }

    public String describe() { return title; }
}
```

```java
public class Task extends WorkItem {
    private final String assignee;

    public Task(String key, String title, String assignee) {
        super(key, title);                 // must be the first statement
        this.assignee = assignee;
    }

    @Override
    public String describe() {
        return getTitle() + " by " + assignee;
    }
}

public class Bug extends WorkItem {
    private final int severity;

    public Bug(String id, String title, int severity) {
        super(id, title);
        this.severity = severity;
    }

    @Override
    public int targetDays() { return 7; }

    @Override
    public String describe() {
        return getTitle() + " (bug, severity " + severity + ")";
    }
}
```

`Task` and `Bug` **are** `WorkItem`s: they inherit `getId()`, `pickUp()`, `isAvailable()` and the rest, and **override** what's different.

> [!plain] In plain English
> `class Bug extends WorkItem` means "a bug is a kind of work item: it has everything an item has, plus or instead of a few things".

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
public class Milestone extends WorkItem {
    private final int sprint;

    public Milestone(String id, String title, int sprint) {
        super(id, title);
        this.sprint = sprint;
    }

    @Override
    public void pickUp() {
        throw new UnsupportedOperationException("Milestones are not assignable");
    }

    @Override
    public String describe() {
        return super.describe() + " (sprint " + sprint + ")";      // reuse the parent's text
    }
}
```

## Object: the root of everything

Every class extends `java.lang.Object` (directly or indirectly), which provides `toString()`, `equals(Object)`, `hashCode()` and more. Overriding `equals` and `hashCode` is how you define what "the same item" means:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof WorkItem other)) return false;
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
// A Assignment isn't a kind of Task. It *has* an item and a member.
public class Assignment {
    private final WorkItem item;
    private final Member member;
    private final LocalDate dueOn;
    // ...
}
```

The famous trap is `class Stack extends ArrayList`: the stack inherits `add(index, x)`, `remove(index)` and other methods that let callers break its last-in-first-out rule. A stack that **has** a list and exposes only `push` and `pop` is correct.

> [!mistake] Deep hierarchies
> `Item → PhysicalItem → PrintedItem → BoundItem → Task → Hardcover` is hard to understand and harder to change. Keep hierarchies shallow, one or two levels, and use interfaces (next lesson) for shared capabilities.

:::quiz
q: What must a subclass constructor do if the parent has only `WorkItem(String id, String title)`?
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
q: Which relationship should `Assignment` have with `Member`?
- Assignment extends Member
- Member extends Assignment
+ Assignment has a Member field (composition)
- none
why: An assignment isn't a kind of member; it refers to one.
:::

:::exercise
id: ji-dvd
level: 2
title: A Bug subclass
mode: code
lang: java
file: Bug.java
---
Write `Bug extends WorkItem` with a `private final int severity`, a public constructor `Bug(String id, String title, int severity)` that calls `super(id, title)`, and overrides (with `@Override`) of `targetDays()` returning `7` and `describe()` returning `getTitle() + " (bug, severity " + severity + ")"`.
---starter
public class Bug {
}
---rule
public\s+class\s+Bug\s+extends\s+WorkItem
`extends WorkItem`
---rule
private\s+final\s+int\s+severity\s*;
`private final int severity;`
---rule
public\s+Bug\(\s*String\s+id\s*,\s*String\s+title\s*,\s*int\s+severity\s*\)\s*\{\s*super\(\s*id\s*,\s*title\s*\)\s*;
Constructor calls `super(id, title)` first
---rule
@Override\s*\n\s*public\s+int\s+targetDays\(\s*\)\s*\{\s*return\s+7\s*;
`targetDays()` → 7
---rule
@Override\s*\n\s*public\s+String\s+describe\(\s*\)\s*\{\s*return\s+getTitle\(\s*\)\s*\+\s*" \(bug, severity "\s*\+\s*severity\s*\+\s*"\)"\s*;
`describe()`
---solution
public class Bug extends WorkItem {
    private final int severity;

    public Bug(String id, String title, int severity) {
        super(id, title);
        this.severity = severity;
    }

    @Override
    public int targetDays() {
        return 7;
    }

    @Override
    public String describe() {
        return getTitle() + " (bug, severity " + severity + ")";
    }
}
:::

:::exercise
id: ji-equals
level: 3
title: equals and hashCode
mode: code
lang: java
file: WorkItem.java
---
Two `WorkItem` objects with the same `id` are the same item. Override `equals(Object o)` (return true for `this == o`; false unless `o instanceof WorkItem other`; otherwise compare `id`s with `equals`) and `hashCode()` (return `id.hashCode()`).
---starter
public class WorkItem {
    private final String id;
    private final String title;

    public WorkItem(String id, String title) {
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
if\s*\(\s*!\s*\(\s*o\s+instanceof\s+WorkItem\s+other\s*\)\s*\)\s*return\s+false\s*;
Wrong type → false
---rule
return\s+id\.equals\(\s*other\.id\s*\)\s*;
Compare ids
---rule
@Override\s*\n\s*public\s+int\s+hashCode\(\s*\)\s*\{\s*return\s+id\.hashCode\(\s*\)\s*;
`hashCode()` from the id
---solution
public class WorkItem {
    private final String id;
    private final String title;

    public WorkItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof WorkItem other)) return false;
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
WorkItem item = new Bug("B1", "Login crash", 2);
System.out.println(item.describe() + " / " + item.targetDays());
```

(using the `Bug` class from the lesson) What does it print?
---answer
Login crash (bug, severity 2) / 7
---solution
Login crash (bug, severity 2) / 7
---explain
The variable's type is WorkItem, but the object is a Bug, and Java calls the object's overriding methods. That's polymorphism (lesson 6).
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
title: "Project 4: not assignable milestones"
mode: code
lang: java
file: Milestone.java
path: java/src/main/java/taskboard/Milestone.java
---
Write `Milestone extends WorkItem` with `private final int sprint`, constructor `Milestone(String id, String title, int sprint)` calling `super`, an override of `pickUp()` that throws `new UnsupportedOperationException("Milestones are not assignable")`, and an override of `describe()` returning `super.describe() + " (sprint " + sprint + ")"`.
---starter
public class Milestone {
}
---rule
public\s+class\s+Milestone\s+extends\s+WorkItem
`extends WorkItem`
---rule
private\s+final\s+int\s+sprint\s*;
`private final int sprint;`
---rule
Milestone\(\s*String\s+id\s*,\s*String\s+title\s*,\s*int\s+sprint\s*\)\s*\{\s*super\(\s*id\s*,\s*title\s*\)\s*;
Constructor with `super`
---rule
@Override\s*\n\s*public\s+void\s+pickUp\(\s*\)\s*\{\s*throw\s+new\s+UnsupportedOperationException\(\s*"Milestones are not assignable"\s*\)\s*;
`pickUp()` is refused
---rule
@Override\s*\n\s*public\s+String\s+describe\(\s*\)\s*\{\s*return\s+super\.describe\(\s*\)\s*\+\s*" \(sprint "\s*\+\s*sprint\s*\+\s*"\)"\s*;
`describe()` reuses `super.describe()`
---solution
public class Milestone extends WorkItem {
    private final int sprint;

    public Milestone(String id, String title, int sprint) {
        super(id, title);
        this.sprint = sprint;
    }

    @Override
    public void pickUp() {
        throw new UnsupportedOperationException("Milestones are not assignable");
    }

    @Override
    public String describe() {
        return super.describe() + " (sprint " + sprint + ")";
    }
}
:::

:::exercise
id: proj-java-04-loan
level: 3
title: "Project 4b: Assignment uses composition"
mode: code
lang: java
file: Assignment.java
path: java/src/main/java/taskboard/Assignment.java
---
Write an immutable `Assignment` class (not a subclass of anything) with `private final` fields `WorkItem item`, `Member member` and `LocalDate dueOn`, a public constructor taking all three, getters, and `public boolean isOverdue(LocalDate today)` returning `today.isAfter(dueOn)`.
---starter
import java.time.LocalDate;
---rule
public\s+(final\s+)?class\s+Assignment\s*\{
A plain class, no `extends`
---rule
private\s+final\s+WorkItem\s+item\s*;
Has an item
---rule
private\s+final\s+Member\s+member\s*;
Has a member
---rule
private\s+final\s+LocalDate\s+dueOn\s*;
Has a due date
---rule
public\s+Assignment\(\s*WorkItem\s+item\s*,\s*Member\s+member\s*,\s*LocalDate\s+dueOn\s*\)
The constructor
---rule
public\s+WorkItem\s+getItem\(\s*\)[\s\S]*public\s+Member\s+getMember\(\s*\)[\s\S]*public\s+LocalDate\s+getDueOn\(\s*\)
Getters
---rule
public\s+boolean\s+isOverdue\(\s*LocalDate\s+today\s*\)\s*\{\s*return\s+today\.isAfter\(\s*dueOn\s*\)\s*;
`isOverdue(today)`
---solution
import java.time.LocalDate;

public final class Assignment {
    private final WorkItem item;
    private final Member member;
    private final LocalDate dueOn;

    public Assignment(WorkItem item, Member member, LocalDate dueOn) {
        this.item = item;
        this.member = member;
        this.dueOn = dueOn;
    }

    public WorkItem getItem() { return item; }
    public Member getMember() { return member; }
    public LocalDate getDueOn() { return dueOn; }

    public boolean isOverdue(LocalDate today) {
        return today.isAfter(dueOn);
    }
}
:::
