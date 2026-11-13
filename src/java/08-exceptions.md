---
id: java-exceptions
title: Exceptions & error handling
summary: How exceptions propagate, try/catch/finally, checked vs unchecked exceptions, the exception hierarchy, throwing with good messages, custom exception classes, try-with-resources, wrapping causes, and what not to do (swallowing, catching Exception everywhere, exceptions for control flow).
minutes: 35
---
> [!project] Bookshelf, step 8: failures with names
> Borrowing can fail in several ways: the item is out, the member has too many loans, the member owes fees. Right now those are generic `IllegalStateException`s. This step gives each failure its own exception type, so the code that calls `borrow` can react to each one properly.

## What happens when something throws

```java
public static void main(String[] args) {
    checkout("D-404");
}
static void checkout(String id) {
    LibraryItem item = find(id);          // 2. find throws, so checkout stops here...
    item.borrow();
}
static LibraryItem find(String id) {
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
    desk.lend(item, member);
    System.out.println("Enjoy your book!");
} catch (ItemUnavailableException e) {
    System.out.println("Sorry, " + e.getMessage() + ". Want to reserve it?");
} catch (LoanLimitException | OutstandingFeesException e) {   // multi-catch
    System.out.println("Can't lend right now: " + e.getMessage());
} finally {
    audit.log("lend attempted");          // runs whether it succeeded, failed or returned
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
public class LibraryException extends RuntimeException {
    public LibraryException(String message) { super(message); }
}

public class ItemUnavailableException extends LibraryException {
    private final String itemId;

    public ItemUnavailableException(String itemId, String title) {
        super(title + " is already on loan");
        this.itemId = itemId;
    }

    public String getItemId() { return itemId; }
}
```

- Name them after **what went wrong** in domain terms.
- A shared base class (`LibraryException`) lets callers catch "any library rule violation" in one place, which is exactly what a web layer's error handler does.
- Put useful data on them (`itemId`), not just in the message.

## Good messages

`throw new IllegalArgumentException("bad input")` helps nobody. Say **what** was wrong and **with which value**: `"ISBN must be 13 digits, got '97804410'"`. The person reading it at 2 a.m. might be you.

## try-with-resources

Files, sockets and database connections must be **closed**, even when an exception happens. Any `AutoCloseable` declared in the `try (...)` header is closed automatically:

```java
try (BufferedReader in = Files.newBufferedReader(Path.of("catalog.csv"))) {
    String line;
    while ((line = in.readLine()) != null) {
        catalog.add(parse(line));
    }
} catch (IOException e) {
    throw new CatalogLoadException("Couldn't read catalog.csv", e);   // keep the cause
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
q: Why pass the original exception when wrapping: `new CatalogLoadException("…", e)`?
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
file: LoanLimitException.java
---
Write `LoanLimitException extends LibraryException` with a `private final int limit` field, and a constructor `LoanLimitException(String memberName, int limit)` that calls `super(memberName + " already has " + limit + " loans")` and stores the limit. Add `getLimit()`.
---starter
---rule
public\s+class\s+LoanLimitException\s+extends\s+LibraryException
`extends LibraryException`
---rule
private\s+final\s+int\s+limit\s*;
`private final int limit;`
---rule
LoanLimitException\(\s*String\s+memberName\s*,\s*int\s+limit\s*\)\s*\{\s*super\(\s*memberName\s*\+\s*" already has "\s*\+\s*limit\s*\+\s*" loans"\s*\)\s*;
Constructor with a clear message
---rule
this\.limit\s*=\s*limit\s*;
Store the limit
---rule
public\s+int\s+getLimit\(\s*\)\s*\{\s*return\s+(this\.)?limit\s*;
`getLimit()`
---solution
public class LoanLimitException extends LibraryException {
    private final int limit;

    public LoanLimitException(String memberName, int limit) {
        super(memberName + " already has " + limit + " loans");
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
file: CatalogLoader.java
---
Write `static List<String> loadTitles(Path file)` that reads every line with a `BufferedReader` from `Files.newBufferedReader(file)` in a **try-with-resources**, adds each line to a list, and on `IOException` throws `new CatalogLoadException("Couldn't read " + file, e)`.
---starter
import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class CatalogLoader {
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
catch\s*\(\s*IOException\s+e\s*\)\s*\{\s*throw\s+new\s+CatalogLoadException\(\s*"Couldn't read "\s*\+\s*file\s*,\s*e\s*\)
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

public class CatalogLoader {
    static List<String> loadTitles(Path file) {
        List<String> titles = new ArrayList<>();
        try (BufferedReader in = Files.newBufferedReader(file)) {
            String line;
            while ((line = in.readLine()) != null) {
                titles.add(line);
            }
        } catch (IOException e) {
            throw new CatalogLoadException("Couldn't read " + file, e);
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
`ItemUnavailableException extends LibraryException extends RuntimeException`. What does this print?

```java
try {
    throw new ItemUnavailableException("B-1", "Dune");
} catch (ItemUnavailableException e) {
    System.out.println("unavailable");
} catch (LibraryException e) {
    System.out.println("library");
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
title: "Project 8: the loan desk"
mode: code
lang: java
file: LoanDesk.java
---
Write `public Loan lend(Book book, Member member, LocalDate today)` in `LoanDesk` that checks, in this order: if `!book.isAvailable()` throw `new ItemUnavailableException(book.getIsbn(), book.getTitle())`; if `member.getLoans() >= maxLoans` throw `new LoanLimitException(member.getName(), maxLoans)`. Otherwise call `book.borrow()`, `member.addLoan()`, and return `new Loan(book, member, today.plusDays(book.loanDays()))`.
---starter
import java.time.LocalDate;

public class LoanDesk {
    private final int maxLoans;

    public LoanDesk(int maxLoans) {
        this.maxLoans = maxLoans;
    }
}
---rule
public\s+Loan\s+lend\(\s*Book\s+book\s*,\s*Member\s+member\s*,\s*LocalDate\s+today\s*\)
The signature
---rule
if\s*\(\s*!\s*book\.isAvailable\(\s*\)\s*\)\s*\{?\s*throw\s+new\s+ItemUnavailableException\(\s*book\.getIsbn\(\s*\)\s*,\s*book\.getTitle\(\s*\)\s*\)
Unavailable → `ItemUnavailableException`
---rule
if\s*\(\s*member\.getLoans\(\s*\)\s*>=\s*maxLoans\s*\)\s*\{?\s*throw\s+new\s+LoanLimitException\(\s*member\.getName\(\s*\)\s*,\s*maxLoans\s*\)
Too many loans → `LoanLimitException`
---rule
ItemUnavailableException[\s\S]*LoanLimitException
Availability checked first
---rule
book\.borrow\(\s*\)\s*;[\s\S]*member\.addLoan\(\s*\)\s*;
Borrow, then count the loan
---rule
return\s+new\s+Loan\(\s*book\s*,\s*member\s*,\s*today\.plusDays\(\s*book\.loanDays\(\s*\)\s*\)\s*\)\s*;
Return the loan
---solution
import java.time.LocalDate;

public class LoanDesk {
    private final int maxLoans;

    public LoanDesk(int maxLoans) {
        this.maxLoans = maxLoans;
    }

    public Loan lend(Book book, Member member, LocalDate today) {
        if (!book.isAvailable()) {
            throw new ItemUnavailableException(book.getIsbn(), book.getTitle());
        }
        if (member.getLoans() >= maxLoans) {
            throw new LoanLimitException(member.getName(), maxLoans);
        }
        book.borrow();
        member.addLoan();
        return new Loan(book, member, today.plusDays(book.loanDays()));
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
---
Write `static String tryLend(LoanDesk desk, Book book, Member member, LocalDate today)` that calls `desk.lend(...)` and returns `"Due " + loan.getDueOn()`; catches `ItemUnavailableException` returning `"Unavailable: " + e.getMessage()`; and catches `LibraryException` (any other rule) returning `"Refused: " + e.getMessage()`.
---starter
import java.time.LocalDate;

public class Kiosk {
}
---rule
static\s+String\s+tryLend\(\s*LoanDesk\s+desk\s*,\s*Book\s+book\s*,\s*Member\s+member\s*,\s*LocalDate\s+today\s*\)
The signature
---rule
try\s*\{\s*Loan\s+(\w+)\s*=\s*desk\.lend\(\s*book\s*,\s*member\s*,\s*today\s*\)\s*;\s*return\s+"Due "\s*\+\s*\1\.getDueOn\(\s*\)\s*;
Lend and report the due date
---rule
catch\s*\(\s*ItemUnavailableException\s+e\s*\)\s*\{\s*return\s+"Unavailable: "\s*\+\s*e\.getMessage\(\s*\)\s*;
Specific catch first
---rule
catch\s*\(\s*LibraryException\s+e\s*\)\s*\{\s*return\s+"Refused: "\s*\+\s*e\.getMessage\(\s*\)\s*;
General library catch
---rule
ItemUnavailableException\s+e[\s\S]*LibraryException\s+e
Specific before general
---solution
import java.time.LocalDate;

public class Kiosk {
    static String tryLend(LoanDesk desk, Book book, Member member, LocalDate today) {
        try {
            Loan loan = desk.lend(book, member, today);
            return "Due " + loan.getDueOn();
        } catch (ItemUnavailableException e) {
            return "Unavailable: " + e.getMessage();
        } catch (LibraryException e) {
            return "Refused: " + e.getMessage();
        }
    }
}
:::
