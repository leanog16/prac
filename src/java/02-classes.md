---
id: java-classes
title: Classes & objects
summary: What a class and an object are, fields and constructors, instance methods and `this`, creating objects with `new`, references and `null`, static vs instance members, and toString for readable output.
minutes: 35
---
> [!project] Bookshelf, step 2: the Book class
> So far a book is just a `String`. A real book has an ISBN, a title, an author, a year and an availability status, and it can *do* things: be borrowed, be returned, describe itself. In this lesson those facts and behaviours come together in a `Book` class.

## A class is a blueprint

A **class** describes a kind of thing: what data each one holds (**fields**) and what it can do (**methods**). An **object** is one concrete thing built from that blueprint.

```java title=Book.java
public class Book {
    // fields: the state each Book object carries
    String isbn;
    String title;
    String author;
    int year;
    boolean available = true;

    // constructor: runs once, when the object is created
    Book(String isbn, String title, String author, int year) {
        this.isbn = isbn;
        this.title = title;
        this.author = author;
        this.year = year;
    }

    // instance methods: behaviour that uses this object's fields
    void borrow() {
        available = false;
    }

    void giveBack() {
        available = true;
    }

    String describe() {
        return title + " by " + author + " (" + year + ")";
    }
}
```

```java title=Main.java
Book dune = new Book("9780441013593", "Dune", "Frank Herbert", 1965);
Book emma = new Book("9780141439587", "Emma", "Jane Austen", 1815);

dune.borrow();
System.out.println(dune.describe());     // Dune by Frank Herbert (1965)
System.out.println(dune.available);      // false
System.out.println(emma.available);      // true: each object has its own fields
```

> [!plain] In plain English
> The class `Book` is the cookie cutter; `dune` and `emma` are the cookies. Every cookie has its own copy of the fields, and methods act on the cookie you call them on.

## Constructors and `this`

`new Book(...)` allocates a new object and runs the **constructor**. Inside it, `this` means "the object being built". `this.title = title` copies the **parameter** `title` into the **field** `title`. Without `this.`, the parameter would shadow the field and the field would stay `null`.

A class can have several constructors (**overloading**), and one can call another with `this(...)`:

```java
Book(String isbn, String title, String author) {
    this(isbn, title, author, 0);        // delegate to the 4-argument constructor
}
```

If you write **no** constructor, Java provides an empty no-argument one. Once you write any constructor, that free one disappears.

## Objects live behind references

```java
Book a = new Book("1", "Dune", "Herbert", 1965);
Book b = a;              // b points at the SAME object
b.borrow();
System.out.println(a.available);    // false: there's only one book

Book c = null;           // c points at nothing
c.borrow();              // NullPointerException at runtime
```

```
a ──┐
    ├──► [ Book: Dune, available=false ]
b ──┘
c ──► null
```

`NullPointerException` (NPE) is the most common Java runtime error: you called a method through a reference that points at nothing. Prevent it by never letting important references be `null` (initialize fields in constructors; prefer empty collections to `null`; use `Optional` for "maybe absent", lesson 9).

## Static vs instance members

| | Instance member | `static` member |
|---|---|---|
| belongs to | each object | the class itself (one copy, shared) |
| call it with | `dune.describe()` | `Book.count()` |
| can use `this`? | yes | no: there's no object |
| typical use | the object's state and behaviour | constants, counters, factory and utility methods |

```java
public class Book {
    static int created = 0;                       // one counter shared by all books
    static final int MAX_TITLE = 200;             // a constant

    Book(String isbn, String title, String author, int year) {
        // ...
        created++;
    }
}
```

## toString: readable objects

Printing an object calls its `toString()` method. The default is useless (`Book@1b6d3586`). Override it:

```java
@Override
public String toString() {
    return "Book[" + isbn + ", " + title + "]";
}

System.out.println(dune);     // Book[9780441013593, Dune]
```

`@Override` asks the compiler to check you really are replacing an inherited method (lesson 4 explains inheritance). A typo like `tostring` would then be a compile error instead of a silent bug.

:::quiz
q: What does `new Book(...)` do?
+ creates a new object in memory, runs the constructor, and returns a reference to it
- copies the Book class
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
q: `Book b = a; b.borrow();` — what happens to `a`?
+ it's borrowed too: both variables reference the same object
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
Write `Member` with fields `String name`, `String email` and `int loans` (starting at 0), a constructor taking `name` and `email` (use `this.`), and methods `void addLoan()` (adds 1 to `loans`) and `boolean canBorrow(int max)` (returns whether `loans < max`).
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
int\s+loans(\s*=\s*0)?\s*;
`int loans`
---rule
Member\(\s*String\s+name\s*,\s*String\s+email\s*\)\s*\{\s*this\.name\s*=\s*name\s*;\s*this\.email\s*=\s*email\s*;
Constructor with `this.`
---rule
void\s+addLoan\(\s*\)\s*\{\s*(loans\+\+|loans\s*\+=\s*1|this\.loans\+\+|loans\s*=\s*loans\s*\+\s*1)\s*;
`addLoan()` increments
---rule
boolean\s+canBorrow\(\s*int\s+max\s*\)\s*\{\s*return\s+(this\.)?loans\s*<\s*max\s*;
`canBorrow(max)`
---solution
public class Member {
    String name;
    String email;
    int loans = 0;

    Member(String name, String email) {
        this.name = name;
        this.email = email;
    }

    void addLoan() {
        loans++;
    }

    boolean canBorrow(int max) {
        return loans < max;
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
Override `toString()` in `Member` (with `@Override`, `public`, returning `String`) so a member prints as `Member[Ada, ada@lib.example]`.
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
Book a = new Book("1", "Dune", "Herbert", 1965);
Book b = new Book("1", "Dune", "Herbert", 1965);
a.borrow();
System.out.println(a.available + " " + b.available + " " + (a == b));
```

What does it print?
---answer
false true false
---solution
false true false
---explain
Two `new` calls make two separate objects. Borrowing one doesn't affect the other, and `==` compares references.
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
title: "Project 2: the Book class"
mode: code
lang: java
file: Book.java
---
Write `Book` with fields `isbn`, `title`, `author` (Strings), `year` (int) and `available` (boolean, initially `true`); a constructor setting the first four with `this.`; `borrow()` and `giveBack()` that set `available`; and `describe()` returning `title + " by " + author + " (" + year + ")"`.
---starter
public class Book {
}
---rule
String\s+isbn\s*;[\s\S]*String\s+title\s*;[\s\S]*String\s+author\s*;
String fields
---rule
int\s+year\s*;
`int year;`
---rule
boolean\s+available\s*=\s*true\s*;
`available` starts true
---rule
Book\(\s*String\s+isbn\s*,\s*String\s+title\s*,\s*String\s+author\s*,\s*int\s+year\s*\)
The constructor
---rule
this\.isbn\s*=\s*isbn\s*;[\s\S]*this\.title\s*=\s*title\s*;[\s\S]*this\.author\s*=\s*author\s*;[\s\S]*this\.year\s*=\s*year\s*;
Assign with `this.`
---rule
void\s+borrow\(\s*\)\s*\{\s*(this\.)?available\s*=\s*false\s*;
`borrow()`
---rule
void\s+giveBack\(\s*\)\s*\{\s*(this\.)?available\s*=\s*true\s*;
`giveBack()`
---rule
String\s+describe\(\s*\)\s*\{\s*return\s+title\s*\+\s*" by "\s*\+\s*author\s*\+\s*" \("\s*\+\s*year\s*\+\s*"\)"\s*;
`describe()`
---solution
public class Book {
    String isbn;
    String title;
    String author;
    int year;
    boolean available = true;

    Book(String isbn, String title, String author, int year) {
        this.isbn = isbn;
        this.title = title;
        this.author = author;
        this.year = year;
    }

    void borrow() {
        available = false;
    }

    void giveBack() {
        available = true;
    }

    String describe() {
        return title + " by " + author + " (" + year + ")";
    }
}
:::

:::exercise
id: proj-java-02-use
level: 2
title: "Project 2b: use the Book class"
mode: code
lang: java
file: Main.java
---
In `main`, create two books (`dune`: `"9780441013593"`, `"Dune"`, `"Frank Herbert"`, `1965`; `emma`: `"9780141439587"`, `"Emma"`, `"Jane Austen"`, `1815`), borrow `dune`, and print both books' `describe()` and then `dune.available`.
---starter
public class Main {
    public static void main(String[] args) {
    }
}
---rule
Book\s+dune\s*=\s*new\s+Book\(\s*"9780441013593"\s*,\s*"Dune"\s*,\s*"Frank Herbert"\s*,\s*1965\s*\)
Create `dune`
---rule
Book\s+emma\s*=\s*new\s+Book\(\s*"9780141439587"\s*,\s*"Emma"\s*,\s*"Jane Austen"\s*,\s*1815\s*\)
Create `emma`
---rule
dune\.borrow\(\s*\)
Borrow `dune`
---rule
System\.out\.println\(\s*dune\.describe\(\s*\)\s*\)[\s\S]*System\.out\.println\(\s*emma\.describe\(\s*\)\s*\)
Print both descriptions
---rule
System\.out\.println\(\s*dune\.available\s*\)
Print availability
---solution
public class Main {
    public static void main(String[] args) {
        Book dune = new Book("9780441013593", "Dune", "Frank Herbert", 1965);
        Book emma = new Book("9780141439587", "Emma", "Jane Austen", 1815);
        dune.borrow();
        System.out.println(dune.describe());
        System.out.println(emma.describe());
        System.out.println(dune.available);
    }
}
:::
