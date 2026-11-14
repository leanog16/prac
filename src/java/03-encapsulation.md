---
id: java-encapsulation
title: Encapsulation & immutability
summary: Access modifiers, private fields with getters and controlled setters, enforcing invariants in constructors and methods, validating arguments, immutable objects and defensive copies, records, and packages.
minutes: 35
---
> [!project] Bookshelf, step 3: books that can't be broken
> In step 2, any code could write `dune.available = false` or `dune.isbn = "oops"` directly. Nothing stopped a book from having a negative year or an empty title. This step **encapsulates** `Book` and `Member` so they can only change in valid ways.

## The problem with public fields

```java
Book dune = new Book("9780441013593", "Dune", "Frank Herbert", 1965);
dune.year = -5;              // nonsense, but compiles
dune.title = null;           // a NullPointerException waiting to happen
dune.available = false;      // "borrowed", but no loan was recorded anywhere
```

Every class has **invariants**: facts that must always be true for its objects. For a book: the ISBN has 13 digits, the title isn't blank, the year isn't in the future. With public fields, any line in the codebase can break them, and the bug shows up far away from where it was caused.

## Access modifiers

| Modifier | Visible from |
|---|---|
| `private` | only inside the same class |
| (none: "package-private") | classes in the same package |
| `protected` | same package, plus subclasses |
| `public` | everywhere |

The rule of thumb: **fields `private`, methods as private as possible**, and a small public surface designed on purpose.

## Encapsulated Book

```java
public class Book {
    private final String isbn;
    private final String title;
    private final String author;
    private final int year;
    private boolean available = true;

    public Book(String isbn, String title, String author, int year) {
        if (isbn == null || !isbn.matches("\\d{13}")) {
            throw new IllegalArgumentException("ISBN must be 13 digits: " + isbn);
        }
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title is required");
        }
        if (year > java.time.Year.now().getValue()) {
            throw new IllegalArgumentException("year is in the future: " + year);
        }
        this.isbn = isbn;
        this.title = title.strip();
        this.author = author;
        this.year = year;
    }

    public String getIsbn() { return isbn; }
    public String getTitle() { return title; }
    public String getAuthor() { return author; }
    public int getYear() { return year; }
    public boolean isAvailable() { return available; }

    public void borrow() {
        if (!available) {
            throw new IllegalStateException(title + " is already borrowed");
        }
        available = false;
    }

    public void giveBack() {
        available = true;
    }
}
```

What changed:

- **Validation in the constructor**: it's impossible to create an invalid `Book`. If the constructor finishes, the object is valid.
- **`final` fields**: ISBN, title, author and year can never change after construction.
- **Getters** expose values read-only. There are **no setters** for things that shouldn't change.
- **Behaviour instead of setters**: `available` changes only through `borrow()` and `giveBack()`, which enforce the rule "you can't borrow a borrowed book".

> [!plain] In plain English
> Encapsulation means an object guards its own data. Other code asks it to *do* things ("borrow yourself"), and the object decides whether that's allowed, instead of anyone reaching in and changing its insides.

> [!mistake] Generating a getter and setter for every field
> IDEs make it a two-click job, and it undoes encapsulation: a public setter is a public field with extra steps. Add a setter only when changing that value directly is a legitimate operation, and validate in it.

## Exceptions for broken rules

- `IllegalArgumentException`: a caller passed a bad argument (invalid ISBN).
- `IllegalStateException`: the call isn't allowed in the object's current state (borrowing a borrowed book).
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
public record Isbn(String value) {
    public Isbn {                                      // compact constructor: validate
        if (value == null || !value.matches("\\d{13}")) {
            throw new IllegalArgumentException("ISBN must be 13 digits");
        }
    }
}

Isbn i = new Isbn("9780441013593");
i.value();                  // accessor (no "get" prefix)
```

A record gets `private final` fields, a constructor, accessors, `equals`, `hashCode` and `toString` automatically. Records are only shallowly immutable: copy mutable components defensively. Use records for **values** (ISBNs, money amounts, coordinates, DTOs); use classes for **entities** with identity and changing state (a `Book` that's borrowed and returned).

## Packages

Packages group related classes and give them a namespace: `org.library.bookshelf.Book`. The folder structure matches the package (`org/library/bookshelf/Book.java`), and `import` brings classes from other packages into scope. Package-private (no modifier) is useful for helpers that only classes in the same package should use.

:::quiz
q: Where should a `Book` check that its ISBN is valid?
+ in its constructor, so an invalid Book can never exist
- in every method that uses the ISBN
- in the code that calls `new Book(...)`
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
q: Which exception fits "borrow() was called on a book that's already borrowed"?
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
Make `Member`'s fields `private` (`name` and `email` also `final`), add public getters `getName()`, `getEmail()` and `getLoans()`, and make the constructor and `addLoan()` public. Don't add setters.
---starter
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
}
---rule
private\s+final\s+String\s+name\s*;
`private final String name;`
---rule
private\s+final\s+String\s+email\s*;
`private final String email;`
---rule
private\s+int\s+loans(\s*=\s*0)?\s*;
`private int loans`
---rule
public\s+String\s+getName\(\s*\)\s*\{\s*return\s+(this\.)?name\s*;
`getName()`
---rule
public\s+String\s+getEmail\(\s*\)\s*\{\s*return\s+(this\.)?email\s*;
`getEmail()`
---rule
public\s+int\s+getLoans\(\s*\)\s*\{\s*return\s+(this\.)?loans\s*;
`getLoans()`
---rule
public\s+Member\(
Public constructor
---rule
public\s+void\s+addLoan\(
Public `addLoan()`
---rule
!void\s+set\w+\(
No setters
---solution
public class Member {
    private final String name;
    private final String email;
    private int loans = 0;

    public Member(String name, String email) {
        this.name = name;
        this.email = email;
    }

    public String getName() { return name; }
    public String getEmail() { return email; }
    public int getLoans() { return loans; }

    public void addLoan() {
        loans++;
    }
}
:::

:::exercise
id: je-guard
level: 2
title: Guard a state change
mode: code
lang: java
file: Book.java
---
Make `borrow()` throw `new IllegalStateException(title + " is already borrowed")` when the book isn't available; otherwise set `available` to false.
---starter
public class Book {
    private final String title;
    private boolean available = true;

    public Book(String title) {
        this.title = title;
    }

    public void borrow() {
        available = false;
    }
}
---rule
if\s*\(\s*!\s*(this\.)?available\s*\)\s*\{?\s*throw\s+new\s+IllegalStateException\(\s*title\s*\+\s*" is already borrowed"\s*\)
Throw when already borrowed
---rule
throw[\s\S]*available\s*=\s*false
Then mark it borrowed
---solution
public class Book {
    private final String title;
    private boolean available = true;

    public Book(String title) {
        this.title = title;
    }

    public void borrow() {
        if (!available) {
            throw new IllegalStateException(title + " is already borrowed");
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
file: Isbn.java
---
Write `public record Isbn(String value)` with a **compact constructor** that throws `new IllegalArgumentException("ISBN must be 13 digits")` when `value` is null or doesn't match `\\d{13}`.
---starter
---rule
public\s+record\s+Isbn\(\s*String\s+value\s*\)
`public record Isbn(String value)`
---rule
public\s+Isbn\s*\{
A compact constructor
---rule
value\s*==\s*null\s*\|\|\s*!\s*value\.matches\(\s*"\\\\d\{13\}"\s*\)
Null or not 13 digits
---rule
throw\s+new\s+IllegalArgumentException\(\s*"ISBN must be 13 digits"\s*\)
Throw
---solution
public record Isbn(String value) {
    public Isbn {
        if (value == null || !value.matches("\\d{13}")) {
            throw new IllegalArgumentException("ISBN must be 13 digits");
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
title: "Project 3: an encapsulated Book"
mode: code
lang: java
file: Book.java
---
Rewrite `Book`: all four data fields `private final`, `available` `private`; the public constructor throws `IllegalArgumentException("ISBN must be 13 digits")` unless the isbn matches `\\d{13}`, and `IllegalArgumentException("title is required")` when the title is null or blank; public getters `getIsbn()`, `getTitle()`, `getAuthor()`, `getYear()` and `isAvailable()`; and public `borrow()` that throws `IllegalStateException` when already borrowed.
---starter
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
}
---rule
private\s+final\s+String\s+isbn\s*;[\s\S]*private\s+final\s+String\s+title\s*;[\s\S]*private\s+final\s+String\s+author\s*;[\s\S]*private\s+final\s+int\s+year\s*;
`private final` data fields
---rule
private\s+boolean\s+available\s*=\s*true\s*;
`private boolean available = true;`
---rule
public\s+Book\(\s*String\s+isbn\s*,\s*String\s+title\s*,\s*String\s+author\s*,\s*int\s+year\s*\)
Public constructor
---rule
isbn\.matches\(\s*"\\\\d\{13\}"\s*\)[\s\S]*?throw\s+new\s+IllegalArgumentException\(\s*"ISBN must be 13 digits"\s*\)
Validate the ISBN
---rule
title\s*==\s*null\s*\|\|\s*title\.isBlank\(\s*\)[\s\S]*?throw\s+new\s+IllegalArgumentException\(\s*"title is required"\s*\)
Validate the title
---rule
public\s+String\s+getIsbn\(\s*\)[\s\S]*public\s+String\s+getTitle\(\s*\)[\s\S]*public\s+String\s+getAuthor\(\s*\)[\s\S]*public\s+int\s+getYear\(\s*\)
Getters
---rule
public\s+boolean\s+isAvailable\(\s*\)\s*\{\s*return\s+(this\.)?available\s*;
`isAvailable()`
---rule
public\s+void\s+borrow\(\s*\)\s*\{\s*if\s*\(\s*!\s*(this\.)?available\s*\)\s*\{?\s*throw\s+new\s+IllegalStateException\(
`borrow()` guards its state
---rule
!void\s+set\w+\(
No setters
---solution
public class Book {
    private final String isbn;
    private final String title;
    private final String author;
    private final int year;
    private boolean available = true;

    public Book(String isbn, String title, String author, int year) {
        if (isbn == null || !isbn.matches("\\d{13}")) {
            throw new IllegalArgumentException("ISBN must be 13 digits");
        }
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title is required");
        }
        this.isbn = isbn;
        this.title = title;
        this.author = author;
        this.year = year;
    }

    public String getIsbn() { return isbn; }
    public String getTitle() { return title; }
    public String getAuthor() { return author; }
    public int getYear() { return year; }
    public boolean isAvailable() { return available; }

    public void borrow() {
        if (!available) {
            throw new IllegalStateException(title + " is already borrowed");
        }
        available = false;
    }

    public void giveBack() {
        available = true;
    }
}
:::
