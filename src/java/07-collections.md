---
id: java-collections
title: Collections & generics
summary: List, Set and Map and their main implementations, iterating and modifying safely, choosing the right collection, why equals/hashCode matter for HashSet and HashMap, unmodifiable collections, writing generic classes and methods, bounded types and wildcards.
minutes: 40
---
> [!project] Bookshelf, step 7: the catalog
> A library with three hard-coded books isn't much use. This step builds the `Catalog`: items indexed by id for instant lookup, a set of authors, members' loans in a map, and a small generic `Repository<T>` that the later lessons reuse.

## The three core interfaces

| Interface | Is | Duplicates | Order | Main implementations |
|---|---|---|---|---|
| `List<E>` | a sequence by position | allowed | insertion order, by index | `ArrayList` (default), `LinkedList` |
| `Set<E>` | a collection of unique elements | no | `HashSet`: none; `LinkedHashSet`: insertion; `TreeSet`: sorted | `HashSet` (default) |
| `Map<K, V>` | keys to values | unique keys | `HashMap`: none; `LinkedHashMap`: insertion; `TreeMap`: sorted keys | `HashMap` (default) |

```java
List<Book> shelf = new ArrayList<>();
shelf.add(dune);
shelf.get(0);                 // by position
shelf.size();
shelf.contains(dune);         // uses equals(); O(n) scan

Set<String> authors = new HashSet<>();
authors.add("Frank Herbert");
authors.add("Frank Herbert");    // ignored: already present
authors.size();                  // 1

Map<String, Book> byIsbn = new HashMap<>();
byIsbn.put(dune.getIsbn(), dune);
byIsbn.get("9780441013593");                  // dune, in O(1)
byIsbn.getOrDefault("123", null);
byIsbn.containsKey("9780441013593");
for (Map.Entry<String, Book> e : byIsbn.entrySet()) { e.getKey(); e.getValue(); }
```

> [!plain] In plain English
> A **List** is a numbered line of things. A **Set** is a bag with no duplicates. A **Map** is a dictionary: look up a value by its key.

## Choosing the right one

The question to ask is "**how will I look things up?**":

| Need | Choose | Lookup cost |
|---|---|---|
| keep things in order, access by position | `ArrayList` | `get(i)`: O(1); `contains`: O(n) |
| "is X in here?" quickly, no duplicates | `HashSet` | O(1) |
| find a value by a key (ISBN → Book) | `HashMap` | O(1) |
| keep keys sorted, range queries | `TreeMap` | O(log n) |
| a queue or stack | `ArrayDeque` | O(1) at both ends |

`catalog.contains(book)` on a list of 100,000 books checks up to 100,000 elements; `byIsbn.containsKey(isbn)` checks about one. Picking the wrong collection is the most common performance bug in everyday Java.

## equals and hashCode, again

`HashSet` and `HashMap` find elements by `hashCode()` first, then confirm with `equals()`. If your class doesn't override them consistently (lesson 4), two "equal" books are treated as different, and `set.contains(sameIsbnBook)` returns `false`. Records get both for free, which is one reason they make good map keys.

> [!mistake] Mutating a key after inserting it
> If a field used in `hashCode()` changes while the object is in a `HashSet` or used as a `HashMap` key, it's now in the wrong bucket and can't be found. Use immutable keys (Strings, records).

## Modifying while iterating

```java
for (Book b : shelf) {
    if (!b.isAvailable()) shelf.remove(b);     // ConcurrentModificationException
}

shelf.removeIf(b -> !b.isAvailable());         // correct
```

## Unmodifiable collections

`List.of(...)`, `Set.of(...)`, `Map.of(...)` and `List.copyOf(...)` create **unmodifiable** collections: `add` throws `UnsupportedOperationException`. Return them from getters so callers can't change your object's internals (lesson 3's defensive copies).

## Generics

Collections are **generic**: `List<Book>` is a list that the compiler guarantees contains only Books, with no casts:

```java
List<Book> books = new ArrayList<>();
books.add(new Dvd(...));       // compile error, caught early
Book b = books.get(0);         // no cast needed
```

You can write generic classes yourself. A repository that stores anything with an id:

```java
public interface Identifiable {
    String getId();
}

public class Repository<T extends Identifiable> {      // T must have getId()
    private final Map<String, T> items = new HashMap<>();

    public void save(T item) {
        items.put(item.getId(), item);
    }

    public Optional<T> findById(String id) {
        return Optional.ofNullable(items.get(id));
    }

    public List<T> findAll() {
        return List.copyOf(items.values());
    }
}

Repository<Book> books = new Repository<>();
Repository<Member> members = new Repository<>();
```

`<T extends Identifiable>` is a **bounded type parameter**: `T` can be any type, as long as it's an `Identifiable`, which is what lets `save` call `item.getId()`.

## Wildcards, briefly

`List<Dvd>` is **not** a `List<LibraryItem>` (otherwise you could add a `Book` to a list of DVDs through it). To accept "a list of any kind of item" for reading, use a wildcard:

```java
static int totalLoanDays(List<? extends Borrowable> items) { ... }   // read items out: "extends"
static void addDefaults(List<? super Book> target) { ... }           // put Books in: "super"
```

The rule of thumb is **PECS**: Producer `extends`, Consumer `super`.

:::quiz
q: You need to check thousands of times whether an ISBN is in the catalog. Which collection?
- ArrayList<String>
+ HashSet<String> (or a HashMap keyed by ISBN)
- LinkedList<String>
- String[]
why: Hash-based lookups are O(1); list contains is O(n).
:::

:::quiz
q: What happens with `List.of("a", "b").add("c")`?
- the list becomes [a, b, c]
+ UnsupportedOperationException
- compile error
- returns false
why: List.of returns an unmodifiable list.
:::

:::quiz
q: Why does `Repository<T extends Identifiable>` need the bound?
+ so code inside the class can call `getId()` on a T
- to make T a subclass of Repository
- generics require a bound
- for performance
why: Without the bound, T could be any type and getId() wouldn't be known to exist.
:::

:::quiz
q: Is `List<Dvd>` a subtype of `List<LibraryItem>`?
- yes, because Dvd extends LibraryItem
+ no; use `List<? extends LibraryItem>` to accept both
- only for ArrayList
- only at runtime
why: Generics are invariant; wildcards express covariance safely.
:::

:::exercise
id: jco-index
level: 2
title: Index books by ISBN
mode: code
lang: java
file: Index.java
---
Write `static Map<String, Book> byIsbn(List<Book> books)` that builds a `HashMap` from each book's `getIsbn()` to the book, and returns it.
---starter
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Index {
}
---rule
static\s+Map<String,\s*Book>\s+byIsbn\(\s*List<Book>\s+books\s*\)
The signature
---rule
Map<String,\s*Book>\s+\w+\s*=\s*new\s+HashMap<>\(\s*\)
A new HashMap
---rule
for\s*\(\s*Book\s+(\w+)\s*:\s*books\s*\)\s*\{?\s*\w+\.put\(\s*\1\.getIsbn\(\s*\)\s*,\s*\1\s*\)
Put each book under its ISBN
---rule
return\s+\w+\s*;
Return the map
---solution
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Index {
    static Map<String, Book> byIsbn(List<Book> books) {
        Map<String, Book> index = new HashMap<>();
        for (Book b : books) {
            index.put(b.getIsbn(), b);
        }
        return index;
    }
}
:::

:::exercise
id: jco-remove
level: 2
title: Remove safely
mode: code
lang: java
file: Shelf.java
---
This method throws `ConcurrentModificationException`. Fix it with `removeIf`.
---starter
import java.util.List;

public class Shelf {
    static void dropBorrowed(List<Book> shelf) {
        for (Book b : shelf) {
            if (!b.isAvailable()) {
                shelf.remove(b);
            }
        }
    }
}
---rule
shelf\.removeIf\(\s*(\w+)\s*->\s*!\s*\1\.isAvailable\(\s*\)\s*\)
`removeIf(b -> !b.isAvailable())`
---rule
!shelf\.remove\(
No `remove` inside a loop
---solution
import java.util.List;

public class Shelf {
    static void dropBorrowed(List<Book> shelf) {
        shelf.removeIf(b -> !b.isAvailable());
    }
}
:::

:::exercise
id: jco-predict-set
level: 2
title: Predict: a set of strings
mode: answer
---
```java
Set<String> authors = new HashSet<>(List.of("Herbert", "Austen", "Herbert", "Joyce", "Austen"));
System.out.println(authors.size());
```

What does it print?
---answer
3
---solution
3
:::

:::exercise
id: jco-predict-hash
level: 3
title: Predict: equals without hashCode
mode: answer
---
`Isbn` is a **class** (not a record) that overrides `equals` to compare the value but does **not** override `hashCode`. What does this most likely print: `true` or `false`?

```java
Set<Isbn> set = new HashSet<>();
set.add(new Isbn("9780441013593"));
System.out.println(set.contains(new Isbn("9780441013593")));
```
---answer
false
---solution
false
---explain
The two objects get different default hash codes, so the set looks in the wrong bucket and never calls equals.
:::

:::exercise
id: proj-java-07-repo
level: 3
title: "Project 7: a generic repository"
mode: code
lang: java
file: Repository.java
---
Write `public class Repository<T extends Identifiable>` with a `private final Map<String, T> items = new HashMap<>()`, `save(T item)` storing it under `item.getId()`, `Optional<T> findById(String id)` returning `Optional.ofNullable(items.get(id))`, and `List<T> findAll()` returning `List.copyOf(items.values())`.
---starter
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
---rule
public\s+class\s+Repository<\s*T\s+extends\s+Identifiable\s*>
Bounded type parameter
---rule
private\s+final\s+Map<String,\s*T>\s+items\s*=\s*new\s+HashMap<>\(\s*\)
The backing map
---rule
public\s+void\s+save\(\s*T\s+item\s*\)\s*\{\s*items\.put\(\s*item\.getId\(\s*\)\s*,\s*item\s*\)
`save`
---rule
public\s+Optional<T>\s+findById\(\s*String\s+id\s*\)\s*\{\s*return\s+Optional\.ofNullable\(\s*items\.get\(\s*id\s*\)\s*\)
`findById`
---rule
public\s+List<T>\s+findAll\(\s*\)\s*\{\s*return\s+List\.copyOf\(\s*items\.values\(\s*\)\s*\)
`findAll` returns an unmodifiable copy
---solution
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public class Repository<T extends Identifiable> {
    private final Map<String, T> items = new HashMap<>();

    public void save(T item) {
        items.put(item.getId(), item);
    }

    public Optional<T> findById(String id) {
        return Optional.ofNullable(items.get(id));
    }

    public List<T> findAll() {
        return List.copyOf(items.values());
    }
}
:::

:::exercise
id: proj-java-07-loans-by-member
level: 3
title: "Project 7b: loans per member"
mode: code
lang: java
file: LoanBook.java
---
Write a class `LoanBook` with `private final Map<String, List<Loan>> byMember = new HashMap<>()`, a method `record(String memberId, Loan loan)` that adds the loan to that member's list using `byMember.computeIfAbsent(memberId, k -> new ArrayList<>()).add(loan)`, and `int countFor(String memberId)` returning `byMember.getOrDefault(memberId, List.of()).size()`.
---starter
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
---rule
private\s+final\s+Map<String,\s*List<Loan>>\s+byMember\s*=\s*new\s+HashMap<>\(\s*\)
The map of lists
---rule
void\s+record\(\s*String\s+memberId\s*,\s*Loan\s+loan\s*\)
`record(memberId, loan)`
---rule
byMember\.computeIfAbsent\(\s*memberId\s*,\s*\w+\s*->\s*new\s+ArrayList<>\(\s*\)\s*\)\.add\(\s*loan\s*\)
`computeIfAbsent(...).add(loan)`
---rule
int\s+countFor\(\s*String\s+memberId\s*\)\s*\{\s*return\s+byMember\.getOrDefault\(\s*memberId\s*,\s*List\.of\(\s*\)\s*\)\.size\(\s*\)\s*;
`countFor` with a safe default
---solution
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class LoanBook {
    private final Map<String, List<Loan>> byMember = new HashMap<>();

    public void record(String memberId, Loan loan) {
        byMember.computeIfAbsent(memberId, k -> new ArrayList<>()).add(loan);
    }

    public int countFor(String memberId) {
        return byMember.getOrDefault(memberId, List.of()).size();
    }
}
:::
