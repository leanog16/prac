---
id: java-streams
title: Lambdas, streams & Optional
summary: Functional interfaces and lambdas, method references, the Stream pipeline (filter, map, sorted, limit, collect), collectors for grouping, counting and joining, reductions, Optional for values that might be missing, and when a plain loop is clearer.
minutes: 40
---
> [!project] Bookshelf, step 9: reports in a few lines
> The librarians want reports: overdue loans sorted by due date, books per author, total fees owed, the most borrowed titles. Streams express each of those as a short pipeline that reads like the question.

## Lambdas: behaviour as a value

A **lambda** is a short anonymous function. It can be passed wherever a **functional interface** (an interface with exactly one abstract method) is expected:

```java
Predicate<Book> isAvailable = b -> b.isAvailable();       // Book → boolean
Function<Book, String> title = b -> b.getTitle();         // Book → String
Comparator<Book> byYear = (a, b) -> Integer.compare(a.getYear(), b.getYear());
Runnable hello = () -> System.out.println("hi");          // nothing → nothing
```

**Method references** are even shorter when the lambda just calls one method: `Book::isAvailable`, `Book::getTitle`, `System.out::println`.

| Functional interface | Shape | Example |
|---|---|---|
| `Predicate<T>` | T → boolean | `b -> b.getYear() < 1900` |
| `Function<T, R>` | T → R | `Book::getAuthor` |
| `Consumer<T>` | T → nothing | `System.out::println` |
| `Supplier<T>` | nothing → T | `ArrayList::new` |
| `Comparator<T>` | (T, T) → int | `Comparator.comparing(Book::getTitle)` |

> [!plain] In plain English
> A lambda is a little piece of code you hand to another method: "here's how to test a book", "here's how to turn a book into a title".

## The stream pipeline

```java
List<String> oldTitles = books.stream()           // 1. source
    .filter(b -> b.getYear() < 1900)              // 2. intermediate operations…
    .sorted(Comparator.comparing(Book::getYear))
    .map(Book::getTitle)
    .limit(5)
    .toList();                                    // 3. terminal operation
```

Read it top to bottom as a sentence: "from the books, keep those before 1900, sort by year, take their titles, at most five, into a list".

- **Intermediate** operations (`filter`, `map`, `sorted`, `distinct`, `limit`) return a new stream and are **lazy**: nothing happens until a terminal operation runs.
- **Terminal** operations (`toList`, `collect`, `count`, `forEach`, `anyMatch`, `findFirst`, `reduce`) produce the result.
- Stream operations do not themselves change the source collection, though your lambdas can mutate objects or external state; avoid those side effects. A stream can only be used **once**.

## Collectors: grouping and summarizing

```java
Map<String, List<Book>> byAuthor = books.stream()
    .collect(Collectors.groupingBy(Book::getAuthor));

Map<String, Long> countByAuthor = books.stream()
    .collect(Collectors.groupingBy(Book::getAuthor, Collectors.counting()));

String titles = books.stream()
    .map(Book::getTitle)
    .collect(Collectors.joining(", "));            // "Dune, Emma, Ulysses"

BigDecimal totalFees = loans.stream()
    .map(l -> l.feeOn(today))
    .reduce(BigDecimal.ZERO, BigDecimal::add);     // sum BigDecimals

double avgYear = books.stream().mapToInt(Book::getYear).average().orElse(0);
```

This is the same idea as SQL's `GROUP BY` and Bash's `sort | uniq -c`, inside Java.

## Optional: "there might not be one"

```java
Optional<Book> first = books.stream()
    .filter(b -> b.getAuthor().equals("Jane Austen"))
    .findFirst();

String title = first.map(Book::getTitle).orElse("(none)");
Book b = first.orElseThrow(() -> new BookNotFoundException("No Austen in stock"));
first.ifPresent(book -> System.out.println(book.getTitle()));
```

`Optional` makes "might be missing" part of the **type**, so callers can't forget to handle it the way they forget to check for `null`. Use it as a **return type**. Don't use it for fields or parameters, and never call `.get()` without checking (use `orElse`, `orElseThrow`, `map`).

## Streams or loops?

Streams shine for **transform/filter/aggregate** questions. Plain loops are clearer when you need early exits with complex conditions, multiple accumulators updated together, or checked exceptions in the body. Use whichever reads better; correctness and clarity beat cleverness.

> [!mistake] Side effects inside streams
> `stream().forEach(b -> list.add(b))` or modifying shared state in `map` defeats the purpose and breaks with parallel streams. Collect results with `toList()` or a collector instead.

:::quiz
q: What does `books.stream().filter(...).map(...)` do without a terminal operation?
+ nothing yet: intermediate operations are lazy
- filters and maps the books immediately
- throws an exception
- modifies the books list
why: Work happens only when a terminal operation pulls elements through.
:::

:::quiz
q: Which collector counts books per author?
- Collectors.toMap(Book::getAuthor, 1)
+ Collectors.groupingBy(Book::getAuthor, Collectors.counting())
- Collectors.joining(Book::getAuthor)
- Collectors.counting(Book::getAuthor)
why: groupingBy with a downstream counting collector.
:::

:::quiz
q: What's the safe way to get a value out of an Optional<Book> that may be empty?
- opt.get()
+ opt.orElse(defaultBook) or opt.orElseThrow(...)
- (Book) opt
- opt.value
why: get() throws NoSuchElementException when empty; orElse/orElseThrow make the empty case explicit.
:::

:::quiz
q: `Book::getTitle` is equivalent to which lambda?
+ `b -> b.getTitle()`
- `() -> getTitle()`
- `(a, b) -> a.getTitle()`
- `b -> Book.getTitle(b)` only for static methods
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
Write `static List<String> availableTitles(List<Book> books)` returning the titles of available books, sorted alphabetically, using a stream with `filter(Book::isAvailable)`, `map(Book::getTitle)`, `sorted()` and `toList()`.
---starter
import java.util.List;

public class Reports {
}
---rule
static\s+List<String>\s+availableTitles\(\s*List<Book>\s+books\s*\)
The signature
---rule
books\.stream\(\s*\)
Start a stream
---rule
\.filter\(\s*(Book::isAvailable|(\w+)\s*->\s*\2\.isAvailable\(\s*\))\s*\)
Keep available books
---rule
\.map\(\s*(Book::getTitle|(\w+)\s*->\s*\2\.getTitle\(\s*\))\s*\)
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
    static List<String> availableTitles(List<Book> books) {
        return books.stream()
                .filter(Book::isAvailable)
                .map(Book::getTitle)
                .sorted()
                .toList();
    }
}
:::

:::exercise
id: js-group
level: 3
title: Books per author
mode: code
lang: java
file: Reports.java
---
Write `static Map<String, Long> countByAuthor(List<Book> books)` using `Collectors.groupingBy(Book::getAuthor, Collectors.counting())`.
---starter
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class Reports {
}
---rule
static\s+Map<String,\s*Long>\s+countByAuthor\(\s*List<Book>\s+books\s*\)
The signature
---rule
books\.stream\(\s*\)\s*\.collect\(\s*Collectors\.groupingBy\(\s*Book::getAuthor\s*,\s*Collectors\.counting\(\s*\)\s*\)\s*\)
groupingBy with counting
---solution
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class Reports {
    static Map<String, Long> countByAuthor(List<Book> books) {
        return books.stream().collect(Collectors.groupingBy(Book::getAuthor, Collectors.counting()));
    }
}
:::

:::exercise
id: js-optional
level: 2
title: Find or explain
mode: code
lang: java
file: Catalog.java
---
Write `static String titleOrNone(List<Book> books, String isbn)` that finds the first book with that ISBN (`filter(b -> b.getIsbn().equals(isbn)).findFirst()`), and returns its title, or `"(not in catalog)"` using `map` and `orElse`.
---starter
import java.util.List;

public class Catalog {
}
---rule
static\s+String\s+titleOrNone\(\s*List<Book>\s+books\s*,\s*String\s+isbn\s*\)
The signature
---rule
\.filter\(\s*(\w+)\s*->\s*\1\.getIsbn\(\s*\)\.equals\(\s*isbn\s*\)\s*\)
Filter by ISBN with `equals`
---rule
\.findFirst\(\s*\)
`findFirst()`
---rule
\.map\(\s*(Book::getTitle|(\w+)\s*->\s*\2\.getTitle\(\s*\))\s*\)
Map to the title
---rule
\.orElse\(\s*"\(not in catalog\)"\s*\)
Fallback with `orElse`
---rule
!\.get\(\s*\)
No bare `get()`
---solution
import java.util.List;

public class Catalog {
    static String titleOrNone(List<Book> books, String isbn) {
        return books.stream()
                .filter(b -> b.getIsbn().equals(isbn))
                .findFirst()
                .map(Book::getTitle)
                .orElse("(not in catalog)");
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
System.out.println(Stream.of("Dune", "Emma", "Ulysses")
    .filter(t -> t.length() == 4)
    .map(String::toUpperCase)
    .collect(Collectors.joining("|")));
```

What does it print?
---answer
DUNE|EMMA
---solution
DUNE|EMMA
:::

:::exercise
id: proj-java-09-overdue
level: 3
title: "Project 9: the overdue report"
mode: code
lang: java
file: LoanReports.java
---
Write `static List<Loan> overdue(List<Loan> loans, LocalDate today)` returning the loans where `isOverdue(today)` is true, sorted by `getDueOn()` (oldest first), using `filter`, `sorted(Comparator.comparing(Loan::getDueOn))` and `toList()`.
---starter
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;

public class LoanReports {
}
---rule
static\s+List<Loan>\s+overdue\(\s*List<Loan>\s+loans\s*,\s*LocalDate\s+today\s*\)
The signature
---rule
\.filter\(\s*(\w+)\s*->\s*\1\.isOverdue\(\s*today\s*\)\s*\)
Keep overdue loans
---rule
\.sorted\(\s*Comparator\.comparing\(\s*Loan::getDueOn\s*\)\s*\)
Oldest due date first
---rule
\.toList\(\s*\)|\.collect\(\s*Collectors\.toList\(\s*\)\s*\)
Collect
---solution
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;

public class LoanReports {
    static List<Loan> overdue(List<Loan> loans, LocalDate today) {
        return loans.stream()
                .filter(l -> l.isOverdue(today))
                .sorted(Comparator.comparing(Loan::getDueOn))
                .toList();
    }
}
:::

:::exercise
id: proj-java-09-fees
level: 4
title: "Project 9b: fees owed per member"
mode: code
lang: java
file: LoanReports.java
---
Write `static Map<String, BigDecimal> feesByMember(List<Loan> loans, LocalDate today, FeePolicy policy)`: group overdue loans by `l.getMember().getName()` and sum `policy.feeFor(ChronoUnit.DAYS.between(l.getDueOn(), today))` per member, using `Collectors.groupingBy(…, Collectors.reducing(BigDecimal.ZERO, …, BigDecimal::add))`.
---starter
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class LoanReports {
}
---rule
static\s+Map<String,\s*BigDecimal>\s+feesByMember\(\s*List<Loan>\s+loans\s*,\s*LocalDate\s+today\s*,\s*FeePolicy\s+policy\s*\)
The signature
---rule
\.filter\(\s*(\w+)\s*->\s*\1\.isOverdue\(\s*today\s*\)\s*\)
Only overdue loans
---rule
Collectors\.groupingBy\(\s*(\w+)\s*->\s*\1\.getMember\(\s*\)\.getName\(\s*\)
Group by member name
---rule
Collectors\.reducing\(\s*BigDecimal\.ZERO\s*,
Reduce from zero
---rule
policy\.feeFor\(\s*ChronoUnit\.DAYS\.between\(\s*\w+\.getDueOn\(\s*\)\s*,\s*today\s*\)\s*\)
Fee for the late days
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

public class LoanReports {
    static Map<String, BigDecimal> feesByMember(List<Loan> loans, LocalDate today, FeePolicy policy) {
        return loans.stream()
                .filter(l -> l.isOverdue(today))
                .collect(Collectors.groupingBy(
                        l -> l.getMember().getName(),
                        Collectors.reducing(BigDecimal.ZERO,
                                l -> policy.feeFor(ChronoUnit.DAYS.between(l.getDueOn(), today)),
                                BigDecimal::add)));
    }
}
:::
