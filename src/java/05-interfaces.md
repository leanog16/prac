---
id: java-interfaces
title: Interfaces & abstract classes
summary: Abstract classes and abstract methods, interfaces as contracts, implementing several interfaces, default and static methods, Comparable and Comparator, choosing between an interface and an abstract class, and programming to an interface.
minutes: 40
---
> [!project] Bookshelf, step 5: contracts
> Not every item can be borrowed (magazines can't), and the library wants different fee rules for different members. Instead of special cases everywhere, this step defines **contracts**: a `Borrowable` interface for things that can be lent, and a `FeePolicy` interface for "how much does a late return cost?".

## Abstract classes

Should anyone ever write `new LibraryItem(...)`? No: every real item is a book, a DVD or a magazine. Mark the class **abstract**, and declare methods every subclass **must** provide without a body:

```java
public abstract class LibraryItem {
    private final String id;
    private final String title;

    protected LibraryItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    public String getTitle() { return title; }

    public abstract String describe();       // no body: each subclass must implement it
}
```

- `new LibraryItem(...)` is now a compile error.
- A concrete subclass that forgets `describe()` doesn't compile either.
- Abstract classes can still have fields, constructors and normal methods: they share **state and code**.

## Interfaces: what something can do

An **interface** is a pure contract: method signatures without state.

```java
public interface Borrowable {
    int loanDays();
    boolean isAvailable();
    void borrow();
    void giveBack();
}
```

```java
public class Book extends LibraryItem implements Borrowable {
    private boolean available = true;
    // ...
    @Override public int loanDays() { return 21; }
    @Override public boolean isAvailable() { return available; }
    @Override public void borrow() { /* check and set */ }
    @Override public void giveBack() { available = true; }
    @Override public String describe() { return getTitle(); }
}

public class Magazine extends LibraryItem {         // NOT Borrowable
    @Override public String describe() { return getTitle() + " (reference)"; }
}
```

Now the type system itself says magazines can't be borrowed. A method `void lend(Borrowable item, Member m)` **can't even be called** with a magazine: the mistake is caught at compile time instead of throwing at runtime (compare lesson 4's `UnsupportedOperationException`).

> [!plain] In plain English
> An interface is a promise: "anything that implements me has these methods". Code that only needs the promise doesn't care which class keeps it.

## Several interfaces, one parent

A class can **extend one** class but **implement many** interfaces:

```java
public class Dvd extends LibraryItem implements Borrowable, Comparable<Dvd>, Rateable { ... }
```

That's why capabilities ("can be borrowed", "can be compared", "can be rated") are interfaces: they combine freely.

## Default and static methods

Interfaces can include **default** methods (with a body) that implementers inherit, and **static** helpers:

```java
public interface Borrowable {
    int loanDays();
    boolean isAvailable();
    void borrow();
    void giveBack();

    default LocalDate dueDateFrom(LocalDate start) {      // shared behaviour, overridable
        return start.plusDays(loanDays());
    }

    static boolean anyAvailable(List<? extends Borrowable> items) {
        return items.stream().anyMatch(Borrowable::isAvailable);
    }
}
```

Default methods let interfaces grow without breaking existing implementations. They can't touch fields, because interfaces have no instance state.

## Comparable and Comparator

How should books be sorted? Give the class a **natural order** with `Comparable`, and supply other orders with `Comparator`:

```java
public class Book extends LibraryItem implements Comparable<Book> {
    @Override
    public int compareTo(Book other) {
        return getTitle().compareTo(other.getTitle());     // negative, zero or positive
    }
}

books.sort(null);                                            // natural order: by title
books.sort(Comparator.comparing(Book::getYear));             // by year
books.sort(Comparator.comparing(Book::getAuthor)
                     .thenComparing(Book::getYear).reversed());
```

## Interface or abstract class?

| | Interface | Abstract class |
|---|---|---|
| models | a **capability** ("can be borrowed") | a **family** sharing code and state ("is a library item") |
| state (fields) | no (only constants) | yes |
| constructors | no | yes |
| a class can have | many | one |
| use it when | unrelated classes share behaviour, or you want callers decoupled from implementations | subclasses share real implementation and data |

Common combination: an interface for the contract, plus an optional abstract class implementing the boring parts.

## Program to an interface

```java
List<Book> books = new ArrayList<>();         // declare the interface type
Map<String, Book> byIsbn = new HashMap<>();
FeePolicy fees = new StandardFeePolicy();
```

Code that depends on `List` works with **any** list; code that depends on `ArrayList` is stuck with it. The same idea drives Spring's dependency injection: depend on the interface, receive an implementation.

:::quiz
q: What does marking `LibraryItem` as `abstract` prevent?
+ creating `LibraryItem` objects directly with `new`
- subclassing it
- calling its methods
- giving it fields
why: Abstract classes can't be instantiated; only concrete subclasses can.
:::

:::quiz
q: How many classes can a Java class extend, and how many interfaces can it implement?
- one and one
+ one class, many interfaces
- many and many
- many classes, one interface
why: Single inheritance of classes, multiple implementation of interfaces.
:::

:::quiz
q: What must `compareTo(other)` return when `this` should come **before** `other`?
+ a negative number
- a positive number
- zero
- true
why: Negative means less-than, zero equal, positive greater-than.
:::

:::quiz
q: Why is `List<Book> books = new ArrayList<>()` preferred over `ArrayList<Book> books = …`?
+ the rest of the code depends only on the List contract, so the implementation can change
- ArrayList is deprecated
- it's faster
- List has more methods
why: Programming to an interface keeps code flexible.
:::

:::exercise
id: jif-borrowable
level: 2
title: The Borrowable contract
mode: code
lang: java
file: Borrowable.java
---
Write `public interface Borrowable` with abstract methods `int loanDays()`, `boolean isAvailable()`, `void borrow()` and `void giveBack()`, plus a **default** method `LocalDate dueDateFrom(LocalDate start)` returning `start.plusDays(loanDays())`.
---starter
import java.time.LocalDate;
---rule
public\s+interface\s+Borrowable
`public interface Borrowable`
---rule
int\s+loanDays\(\s*\)\s*;
`int loanDays();`
---rule
boolean\s+isAvailable\(\s*\)\s*;
`boolean isAvailable();`
---rule
void\s+borrow\(\s*\)\s*;
`void borrow();`
---rule
void\s+giveBack\(\s*\)\s*;
`void giveBack();`
---rule
default\s+LocalDate\s+dueDateFrom\(\s*LocalDate\s+start\s*\)\s*\{\s*return\s+start\.plusDays\(\s*loanDays\(\s*\)\s*\)\s*;
The default method
---solution
import java.time.LocalDate;

public interface Borrowable {
    int loanDays();
    boolean isAvailable();
    void borrow();
    void giveBack();

    default LocalDate dueDateFrom(LocalDate start) {
        return start.plusDays(loanDays());
    }
}
:::

:::exercise
id: jif-abstract
level: 2
title: An abstract base
mode: code
lang: java
file: LibraryItem.java
---
Make `LibraryItem` **abstract**, make its constructor `protected`, and add an abstract method `public abstract String describe();`.
---starter
public class LibraryItem {
    private final String id;
    private final String title;

    public LibraryItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    public String getTitle() { return title; }
}
---rule
public\s+abstract\s+class\s+LibraryItem
`public abstract class LibraryItem`
---rule
protected\s+LibraryItem\(\s*String\s+id\s*,\s*String\s+title\s*\)
Protected constructor
---rule
public\s+abstract\s+String\s+describe\(\s*\)\s*;
Abstract `describe()`
---solution
public abstract class LibraryItem {
    private final String id;
    private final String title;

    protected LibraryItem(String id, String title) {
        this.id = id;
        this.title = title;
    }

    public String getTitle() { return title; }

    public abstract String describe();
}
:::

:::exercise
id: jif-comparator
level: 3
title: Sort the catalog
mode: code
lang: java
file: Catalog.java
---
Write `static void sortForDisplay(List<Book> books)` that sorts by author, then by year **newest first**, using `Comparator.comparing(Book::getAuthor).thenComparing(Book::getYear, Comparator.reverseOrder())`.
---starter
import java.util.Comparator;
import java.util.List;

public class Catalog {
}
---rule
static\s+void\s+sortForDisplay\(\s*List<Book>\s+books\s*\)
The signature
---rule
books\.sort\(\s*Comparator\.comparing\(\s*Book::getAuthor\s*\)\s*\.thenComparing\(\s*Book::getYear\s*,\s*Comparator\.reverseOrder\(\s*\)\s*\)\s*\)
Author, then newest year first
---solution
import java.util.Comparator;
import java.util.List;

public class Catalog {
    static void sortForDisplay(List<Book> books) {
        books.sort(Comparator.comparing(Book::getAuthor).thenComparing(Book::getYear, Comparator.reverseOrder()));
    }
}
:::

:::exercise
id: jif-predict-default
level: 2
title: Predict: a default method
mode: answer
---
A `Dvd` implements `Borrowable` with `loanDays()` returning `7` and doesn't override `dueDateFrom`. What does `dvd.dueDateFrom(LocalDate.of(2026, 3, 1))` return (ISO format)?
---answer
2026-03-08
---solution
2026-03-08
:::

:::exercise
id: proj-java-05-fees
level: 3
title: "Project 5: fee policies"
mode: code
lang: java
file: FeePolicy.java
---
Write `public interface FeePolicy` with `BigDecimal feeFor(long daysLate)`, and two implementations: `StandardFeePolicy` returning `new BigDecimal("0.25").multiply(BigDecimal.valueOf(daysLate))`, and `StudentFeePolicy` returning `BigDecimal.ZERO` (students pay no fees). Both with `@Override`.
---starter
import java.math.BigDecimal;
---rule
public\s+interface\s+FeePolicy\s*\{\s*BigDecimal\s+feeFor\(\s*long\s+daysLate\s*\)\s*;
The interface
---rule
class\s+StandardFeePolicy\s+implements\s+FeePolicy
`StandardFeePolicy implements FeePolicy`
---rule
new\s+BigDecimal\(\s*"0\.25"\s*\)\.multiply\(\s*BigDecimal\.valueOf\(\s*daysLate\s*\)\s*\)
25 cents per day
---rule
class\s+StudentFeePolicy\s+implements\s+FeePolicy
`StudentFeePolicy implements FeePolicy`
---rule
StudentFeePolicy[\s\S]*return\s+BigDecimal\.ZERO\s*;
Students pay nothing
---rule
(@Override\s*\n\s*public\s+BigDecimal\s+feeFor[\s\S]*){2}
Both override `feeFor`
---solution
import java.math.BigDecimal;

public interface FeePolicy {
    BigDecimal feeFor(long daysLate);
}

class StandardFeePolicy implements FeePolicy {
    @Override
    public BigDecimal feeFor(long daysLate) {
        return new BigDecimal("0.25").multiply(BigDecimal.valueOf(daysLate));
    }
}

class StudentFeePolicy implements FeePolicy {
    @Override
    public BigDecimal feeFor(long daysLate) {
        return BigDecimal.ZERO;
    }
}
:::

:::exercise
id: proj-java-05-book-borrowable
level: 3
title: "Project 5b: Book implements Borrowable"
mode: code
lang: java
file: Book.java
---
Make `Book` extend the abstract `LibraryItem` **and** implement `Borrowable` and `Comparable<Book>`: implement `loanDays()` (21), `isAvailable()`, `borrow()` (throw `IllegalStateException` if not available), `giveBack()`, `describe()` (returns `getTitle() + " by " + author`), and `compareTo(Book other)` comparing titles.
---starter
public class Book extends LibraryItem {
    private final String author;
    private boolean available = true;

    public Book(String isbn, String title, String author) {
        super(isbn, title);
        this.author = author;
    }
}
---rule
public\s+class\s+Book\s+extends\s+LibraryItem\s+implements\s+(Borrowable\s*,\s*Comparable<Book>|Comparable<Book>\s*,\s*Borrowable)
Extends one, implements two
---rule
public\s+int\s+loanDays\(\s*\)\s*\{\s*return\s+21\s*;
`loanDays()` → 21
---rule
public\s+boolean\s+isAvailable\(\s*\)\s*\{\s*return\s+(this\.)?available\s*;
`isAvailable()`
---rule
public\s+void\s+borrow\(\s*\)\s*\{\s*if\s*\(\s*!\s*(this\.)?available\s*\)\s*\{?\s*throw\s+new\s+IllegalStateException\(
`borrow()` guards its state
---rule
public\s+void\s+giveBack\(\s*\)\s*\{\s*(this\.)?available\s*=\s*true\s*;
`giveBack()`
---rule
public\s+String\s+describe\(\s*\)\s*\{\s*return\s+getTitle\(\s*\)\s*\+\s*" by "\s*\+\s*author\s*;
`describe()`
---rule
public\s+int\s+compareTo\(\s*Book\s+other\s*\)\s*\{\s*return\s+getTitle\(\s*\)\.compareTo\(\s*other\.getTitle\(\s*\)\s*\)\s*;
`compareTo` by title
---solution
public class Book extends LibraryItem implements Borrowable, Comparable<Book> {
    private final String author;
    private boolean available = true;

    public Book(String isbn, String title, String author) {
        super(isbn, title);
        this.author = author;
    }

    @Override
    public int loanDays() { return 21; }

    @Override
    public boolean isAvailable() { return available; }

    @Override
    public void borrow() {
        if (!available) {
            throw new IllegalStateException(getTitle() + " is already borrowed");
        }
        available = false;
    }

    @Override
    public void giveBack() { available = true; }

    @Override
    public String describe() { return getTitle() + " by " + author; }

    @Override
    public int compareTo(Book other) { return getTitle().compareTo(other.getTitle()); }
}
:::
