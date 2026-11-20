---
id: java-classes
title: Classes & objects
summary: What a class and an object are, fields and constructors, instance methods and `this`, creating objects with `new`, references and `null`, static vs instance members, and toString for readable output.
minutes: 35
---
> [!project] Taskboard, step 2: the Task class
> So far a task is just a `String`. A real task has a key (like `TB-101`), a title, an assignee, a size in story **points** and an availability status, and it can *do* things: be picked up, be put back, describe itself. In this lesson those facts and behaviours come together in a `Task` class.

## A class is a blueprint

A **class** describes a kind of thing: what data each one holds (**fields**) and what it can do (**methods**). An **object** is one concrete thing built from that blueprint.

```java title=Task.java
public class Task {
    // fields: the state each Task object carries
    String key;
    String title;
    String assignee;
    int points;
    boolean available = true;

    // constructor: runs once, when the object is created
    Task(String key, String title, String assignee, int points) {
        this.key = key;
        this.title = title;
        this.assignee = assignee;
        this.points = points;
    }

    // instance methods: behaviour that uses this object's fields
    void pickUp() {
        available = false;
    }

    void putBack() {
        available = true;
    }

    String describe() {
        return title + " by " + assignee + " (" + points + " pts)";
    }
}
```

```java title=Main.java
Task api = new Task("TB-101", "Write API", "Ana", 3);
Task login = new Task("TB-102", "Fix login", "Ben", 5);

api.pickUp();
System.out.println(api.describe());     // Write API by Ana (3 pts)
System.out.println(api.available);      // false
System.out.println(login.available);      // true: each object has its own fields
```

> [!plain] In plain English
> The class `Task` is the cookie cutter; `api` and `login` are the cookies. Every cookie has its own copy of the fields, and methods act on the cookie you call them on.

## Constructors and `this`

`new Task(...)` allocates a new object and runs the **constructor**. Inside it, `this` means "the object being built". `this.title = title` copies the **parameter** `title` into the **field** `title`. Without `this.`, the parameter would shadow the field and the field would stay `null`.

A class can have several constructors (**overloading**), and one can call another with `this(...)`:

```java
Task(String key, String title, String assignee) {
    this(key, title, assignee, 0);        // delegate to the 4-argument constructor
}
```

If you write **no** constructor, Java provides an empty no-argument one. Once you write any constructor, that free one disappears.

## Objects live behind references

```java
Task a = new Task("1", "Write API", "Ana", 3);
Task b = a;              // b points at the SAME object
b.pickUp();
System.out.println(a.available);    // false: there's only one task

Task c = null;           // c points at nothing
c.pickUp();              // NullPointerException at runtime
```

```
a ──┐
    ├──► [ Task: Write API, available=false ]
b ──┘
c ──► null
```

`NullPointerException` (NPE) is the most common Java runtime error: you called a method through a reference that points at nothing. Prevent it by never letting important references be `null` (initialize fields in constructors; prefer empty collections to `null`; use `Optional` for "maybe absent", lesson 9).

## Static vs instance members

| | Instance member | `static` member |
|---|---|---|
| belongs to | each object | the class itself (one copy, shared) |
| call it with | `api.describe()` | `Task.count()` |
| can use `this`? | yes | no: there's no object |
| typical use | the object's state and behaviour | constants, counters, factory and utility methods |

```java
public class Task {
    static int created = 0;                       // one counter shared by all tasks
    static final int MAX_TITLE = 200;             // a constant

    Task(String key, String title, String assignee, int points) {
        // ...
        created++;
    }
}
```

## toString: readable objects

Printing an object calls its `toString()` method. The default is useless (`Task@1b6d3586`). Override it:

```java
@Override
public String toString() {
    return "Task[" + key + ", " + title + "]";
}

System.out.println(api);     // Task[TB-101, Write API]
```

`@Override` asks the compiler to check you really are replacing an inherited method (lesson 4 explains inheritance). A typo like `tostring` would then be a compile error instead of a silent bug.

:::quiz
q: What does `new Task(...)` do?
+ creates a new object in memory, runs the constructor, and returns a reference to it
- copies the Task class
- declares a variable
- calls a static method
why: new allocates an object and runs its constructor.
:::

:::quiz
q: In a constructor, what does `this.title = title;` do?
- assigns the field to the parameter
+ copies the parameter `title` into the object's field `title`
- creates a new variable
- nothing; the line is redundant
why: `this.title` is the field; plain `title` is the (shadowing) parameter.
:::

:::quiz
q: `Task b = a; b.pickUp();` — what happens to `a`?
+ it's taken too: both variables reference the same object
- nothing; b is a copy
- compile error
- a becomes null
why: Assigning a reference copies the arrow, not the object.
:::

:::quiz
q: Which is true of a `static` field?
- each object has its own copy
+ there is one copy shared by the whole class
- it can't be changed
- it can only be used in constructors
why: static members belong to the class. (`final` is what makes something unchangeable.)
:::

:::exercise
id: jc-member
level: 2
title: A Member class
mode: code
lang: java
file: Member.java
---
Write `Member` with fields `String name`, `String email` and `int openTasks` (starting at 0), a constructor taking `name` and `email` (use `this.`), and methods `void addTask()` (adds 1 to `openTasks`) and `boolean canPickUp(int max)` (returns whether `openTasks < max`).
---starter
public class Member {
}
---rule
String\s+name\s*;
`String name;`
---rule
String\s+email\s*;
`String email;`
---rule
int\s+openTasks(\s*=\s*0)?\s*;
`int openTasks`
---rule
Member\(\s*String\s+name\s*,\s*String\s+email\s*\)\s*\{\s*this\.name\s*=\s*name\s*;\s*this\.email\s*=\s*email\s*;
Constructor with `this.`
---rule
void\s+addTask\(\s*\)\s*\{\s*(openTasks\+\+|openTasks\s*\+=\s*1|this\.assignments\+\+|openTasks\s*=\s*openTasks\s*\+\s*1)\s*;
`addTask()` increments
---rule
boolean\s+canPickUp\(\s*int\s+max\s*\)\s*\{\s*return\s+(this\.)?openTasks\s*<\s*max\s*;
`canPickUp(max)`
---solution
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

    boolean canPickUp(int max) {
        return openTasks < max;
    }
}
:::

:::exercise
id: jc-tostring
level: 2
title: A readable toString
mode: code
lang: java
file: Member.java
---
Override `toString()` in `Member` (with `@Override`, `public`, returning `String`) so a member prints as `Member[Ada, ada@taskboard.dev]`.
---starter
public class Member {
    String name;
    String email;

    Member(String name, String email) {
        this.name = name;
        this.email = email;
    }
}
---rule
@Override\s*\n\s*public\s+String\s+toString\(\s*\)
`@Override public String toString()`
---rule
return\s+"Member\["\s*\+\s*name\s*\+\s*", "\s*\+\s*email\s*\+\s*"\]"\s*;
The format `Member[name, email]`
---solution
public class Member {
    String name;
    String email;

    Member(String name, String email) {
        this.name = name;
        this.email = email;
    }

    @Override
    public String toString() {
        return "Member[" + name + ", " + email + "]";
    }
}
:::

:::exercise
id: jc-predict-objects
level: 2
title: Predict: two objects
mode: answer
---
```java
Task a = new Task("1", "Write API", "Ana", 3);
Task b = new Task("1", "Write API", "Ana", 3);
a.pickUp();
System.out.println(a.available + " " + b.available + " " + (a == b));
```

What does it print?
---answer
false true false
---solution
false true false
---explain
Two `new` calls make two separate objects. Picking up one doesn't affect the other, and `==` compares references.
:::

:::exercise
id: jc-predict-static
level: 3
title: Predict: a shared counter
mode: answer
---
```java
class Ticket {
    static int next = 1;
    int number;
    Ticket() { number = next; next++; }
}

Ticket t1 = new Ticket();
Ticket t2 = new Ticket();
Ticket t3 = new Ticket();
System.out.println(t2.number + " " + Ticket.next);
```

What does it print?
---answer
2 4
---solution
2 4
:::

:::exercise
id: proj-java-02-book
level: 2
title: "Project 2: the Task class"
mode: code
lang: java
file: Task.java
path: java/src/main/java/taskboard/Task.java
---
Write `Task` with fields `key`, `title`, `assignee` (Strings), `points` (int) and `available` (boolean, initially `true`); a constructor setting the first four with `this.`; `pickUp()` and `putBack()` that set `available`; and `describe()` returning `title + " by " + assignee + " (" + points + " pts)"`.
---starter
public class Task {
}
---rule
String\s+key\s*;[\s\S]*String\s+title\s*;[\s\S]*String\s+assignee\s*;
String fields
---rule
int\s+points\s*;
`int points;`
---rule
boolean\s+available\s*=\s*true\s*;
`available` starts true
---rule
Task\(\s*String\s+key\s*,\s*String\s+title\s*,\s*String\s+assignee\s*,\s*int\s+points\s*\)
The constructor
---rule
this\.key\s*=\s*key\s*;[\s\S]*this\.title\s*=\s*title\s*;[\s\S]*this\.assignee\s*=\s*assignee\s*;[\s\S]*this\.points\s*=\s*points\s*;
Assign with `this.`
---rule
void\s+pickUp\(\s*\)\s*\{\s*(this\.)?available\s*=\s*false\s*;
`pickUp()`
---rule
void\s+putBack\(\s*\)\s*\{\s*(this\.)?available\s*=\s*true\s*;
`putBack()`
---rule
String\s+describe\(\s*\)\s*\{\s*return\s+title\s*\+\s*" by "\s*\+\s*assignee\s*\+\s*" \("\s*\+\s*points\s*\+\s*" pts\)"\s*;
`describe()`
---solution
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

    void putBack() {
        available = true;
    }

    String describe() {
        return title + " by " + assignee + " (" + points + " pts)";
    }
}
:::

:::exercise
id: proj-java-02-use
level: 2
title: "Project 2b: use the Task class"
mode: code
lang: java
file: Main.java
path: java/src/main/java/taskboard/Main.java
---
In `main`, create two tasks (`api`: `"TB-101"`, `"Write API"`, `"Ana"`, `3`; `login`: `"TB-102"`, `"Fix login"`, `"Ben"`, `5`), pick up `api`, and print both tasks' `describe()` and then `api.available`.
---starter
public class Main {
    public static void main(String[] args) {
    }
}
---rule
Task\s+api\s*=\s*new\s+Task\(\s*"TB-101"\s*,\s*"Write API"\s*,\s*"Ana"\s*,\s*3\s*\)
Create `api`
---rule
Task\s+login\s*=\s*new\s+Task\(\s*"TB-102"\s*,\s*"Fix login"\s*,\s*"Ben"\s*,\s*5\s*\)
Create `login`
---rule
api\.pickUp\(\s*\)
Pick up `api`
---rule
System\.out\.println\(\s*api\.describe\(\s*\)\s*\)[\s\S]*System\.out\.println\(\s*login\.describe\(\s*\)\s*\)
Print both descriptions
---rule
System\.out\.println\(\s*api\.available\s*\)
Print availability
---solution
public class Main {
    public static void main(String[] args) {
        Task api = new Task("TB-101", "Write API", "Ana", 3);
        Task login = new Task("TB-102", "Fix login", "Ben", 5);
        api.pickUp();
        System.out.println(api.describe());
        System.out.println(login.describe());
        System.out.println(api.available);
    }
}
:::
