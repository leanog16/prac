## Basics

| Thing | Syntax |
|---|---|
| compile / run | `javac Main.java` · `java Main` (or `java Main.java`) |
| primitives | `int long double boolean char byte short float` |
| references | `String`, arrays, every class; default `null` |
| constants | `static final int MAX = 5;` |
| text equality | `a.equals(b)`, never `==` |
| switch expression | `String s = switch (x) { case "A", "B" -> "ab"; default -> "?"; };` |
| integer division | `7 / 2 == 3`; use `7 / 2.0` for 3.5 |

## Classes

```java
public class Book {
    private final String isbn;                  // encapsulated, immutable
    private boolean available = true;

    public Book(String isbn) {
        if (isbn == null || !isbn.matches("\\d{13}")) throw new IllegalArgumentException("bad ISBN");
        this.isbn = isbn;
    }

    public String getIsbn() { return isbn; }
    public boolean isAvailable() { return available; }

    public void borrow() {
        if (!available) throw new IllegalStateException("already borrowed");
        available = false;
    }

    @Override public String toString() { return "Book[" + isbn + "]"; }
}

public record Isbn(String value) {                    // immutable value with equals/hashCode/toString
    public Isbn { Objects.requireNonNull(value); }
}
```

Access: `private` < package < `protected` < `public`. Fields private; behaviour instead of setters; validate in constructors.

## Inheritance and interfaces

```java
public abstract class LibraryItem {                    // can't be instantiated
    protected LibraryItem(String id) { ... }
    public abstract String describe();
}
public class Dvd extends LibraryItem implements Borrowable, Comparable<Dvd> {
    public Dvd(String id) { super(id); }               // super(...) first
    @Override public String describe() { return "DVD"; }
}
public interface Borrowable {
    int loanDays();
    default LocalDate dueFrom(LocalDate d) { return d.plusDays(loanDays()); }
}
public sealed interface Item permits Book, Dvd {}
String label = switch (item) { case Book b -> "B"; case Dvd d -> "D"; };
if (item instanceof Dvd dvd) { dvd.getMinutes(); }
```

- One superclass, many interfaces. Prefer composition ("has-a") to inheritance ("is-a").
- Static type decides what you may call; dynamic type decides which override runs. Overloads are chosen at compile time.
- `equals` and `hashCode` go together.

## Collections

| Need | Use |
|---|---|
| ordered, by index | `List<T> l = new ArrayList<>()` |
| unique, fast `contains` | `Set<T> s = new HashSet<>()` |
| key → value | `Map<K, V> m = new HashMap<>()` |
| sorted keys | `TreeMap` · sorted set: `TreeSet` |
| queue / stack | `Deque<T> d = new ArrayDeque<>()` |
| unmodifiable | `List.of(…)`, `List.copyOf(…)`, `Map.of(…)` |

`map.getOrDefault(k, d)` · `map.computeIfAbsent(k, x -> new ArrayList<>()).add(v)` · `list.removeIf(p)` · generics `class Repo<T extends Identifiable>` · wildcards: producer `extends`, consumer `super`.

## Exceptions

```java
try (var in = Files.newBufferedReader(path)) {           // auto-closed
    ...
} catch (NoSuchFileException e) {                        // specific first
    ...
} catch (IOException e) {
    throw new CatalogLoadException("Couldn't read " + path, e);   // keep the cause
} finally {
    ...                                                   // always runs
}
```

Checked (`Exception`) must be caught or declared; unchecked (`RuntimeException`) needn't. Use `IllegalArgumentException` for bad input, `IllegalStateException` for wrong state, custom unchecked exceptions for domain rules. Never swallow.

## Streams and Optional

```java
books.stream()
     .filter(Book::isAvailable)
     .sorted(Comparator.comparing(Book::getYear).reversed())
     .map(Book::getTitle)
     .limit(10)
     .toList();

Map<String, Long> perAuthor = books.stream().collect(Collectors.groupingBy(Book::getAuthor, Collectors.counting()));
String csv = titles.stream().collect(Collectors.joining(", "));
BigDecimal total = fees.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
Optional<Book> b = books.stream().filter(x -> x.getYear() < 1900).findFirst();
b.map(Book::getTitle).orElse("none");
```

## SOLID and patterns

| Principle | One-liner |
|---|---|
| Single responsibility | one reason to change |
| Open/closed | extend with new classes, don't edit working ones |
| Liskov | subtypes work wherever the parent does |
| Interface segregation | small, focused interfaces |
| Dependency inversion | depend on interfaces; inject implementations |

Strategy (swappable algorithm) · Factory (centralized creation) · Builder (many optional params) · Observer (notify listeners) · Decorator (wrap to add behaviour) · Adapter (fit an incompatible API).
