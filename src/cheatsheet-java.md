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
public class Task {
    private final String key;                  // encapsulated, immutable
    private boolean available = true;

    public Task(String key) {
        if (key == null || !key.matches("TB-\\d+")) throw new IllegalArgumentException("bad key");
        this.key = key;
    }

    public String getKey() { return key; }
    public boolean isAvailable() { return available; }

    public void pickUp() {
        if (!available) throw new IllegalStateException("already taken");
        available = false;
    }

    @Override public String toString() { return "Task[" + key + "]"; }
}

public record Key(String value) {                    // immutable value with equals/hashCode/toString
    public Key { Objects.requireNonNull(value); }
}
```

Access: `private` < package < `protected` < `public`. Fields private; behaviour instead of setters; validate in constructors.

## Inheritance and interfaces

```java
public abstract class WorkItem {                    // can't be instantiated
    protected WorkItem(String id) { ... }
    public abstract String describe();
}
public class Bug extends WorkItem implements Assignable, Comparable<Bug> {
    public Bug(String id) { super(id); }               // super(...) first
    @Override public String describe() { return "bug"; }
}
public interface Assignable {
    int targetDays();
    default LocalDate dueFrom(LocalDate d) { return d.plusDays(targetDays()); }
}
public sealed interface Item permits Task, Bug {}
String label = switch (item) { case Task b -> "B"; case Bug d -> "D"; };
if (item instanceof Bug bug) { bug.getSeverity(); }
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
    throw new BoardLoadException("Couldn't read " + path, e);   // keep the cause
} finally {
    ...                                                   // always runs
}
```

Checked (`Exception`) must be caught or declared; unchecked (`RuntimeException`) needn't. Use `IllegalArgumentException` for bad input, `IllegalStateException` for wrong state, custom unchecked exceptions for domain rules. Never swallow.

## Streams and Optional

```java
tasks.stream()
     .filter(Task::isAvailable)
     .sorted(Comparator.comparing(Task::getPoints).reversed())
     .map(Task::getTitle)
     .limit(10)
     .toList();

Map<String, Long> perAuthor = tasks.stream().collect(Collectors.groupingBy(Task::getAssignee, Collectors.counting()));
String csv = titles.stream().collect(Collectors.joining(", "));
BigDecimal total = credits.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
Optional<Task> b = tasks.stream().filter(x -> x.getPoints() < 1900).findFirst();
b.map(Task::getTitle).orElse("none");
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
