---
id: java-collections
title: Collections & generics
summary: List, Set and Map and their main implementations, iterating and modifying safely, choosing the right collection, why equals/hashCode matter for HashSet and HashMap, unmodifiable collections, writing generic classes and methods, bounded types and wildcards.
minutes: 40
---
> [!project] Taskboard, step 7: the board
> A team with three hard-coded tasks isn't much use. This step builds the `Board`: items indexed by id for instant lookup, a set of assignees, members' assignments in a map, and a small generic `Repository<T>` that the later lessons reuse.

## The three core interfaces

| Interface | Is | Duplicates | Order | Main implementations |
|---|---|---|---|---|
| `List<E>` | a sequence by position | allowed | insertion order, by index | `ArrayList` (default), `LinkedList` |
| `Set<E>` | a collection of unique elements | no | `HashSet`: none; `LinkedHashSet`: insertion; `TreeSet`: sorted | `HashSet` (default) |
| `Map<K, V>` | keys to values | unique keys | `HashMap`: none; `LinkedHashMap`: insertion; `TreeMap`: sorted keys | `HashMap` (default) |

```java
List<Task> column = new ArrayList<>();
column.add(api);
column.get(0);                 // by position
column.size();
column.contains(api);         // uses equals(); O(n) scan

Set<String> assignees = new HashSet<>();
assignees.add("Ana");
assignees.add("Ana");    // ignored: already present
assignees.size();                  // 1

Map<String, Task> byKey = new HashMap<>();
byKey.put(api.getKey(), api);
byKey.get("TB-101");                  // api, in O(1)
byKey.getOrDefault("123", null);
byKey.containsKey("TB-101");
for (Map.Entry<String, Task> e : byKey.entrySet()) { e.getKey(); e.getValue(); }
```

> [!plain] In plain English
> A **List** is a numbered line of things. A **Set** is a bag with no duplicates. A **Map** is a dictionary: look up a value by its key.

## Choosing the right one

The question to ask is "**how will I look things up?**":

| Need | Choose | Lookup cost |
|---|---|---|
| keep things in order, access by position | `ArrayList` | `get(i)`: O(1); `contains`: O(n) |
| "is X in here?" quickly, no duplicates | `HashSet` | O(1) |
| find a value by a key (key → Task) | `HashMap` | O(1) |
| keep keys sorted, range queries | `TreeMap` | O(log n) |
| a queue or stack | `ArrayDeque` | O(1) at both ends |

A **deque** ("deck", double-ended queue) adds and removes at both ends. Used as a first-in, first-out queue, add at the back and take from the front:

```java
Deque<String> waiting = new ArrayDeque<>();
waiting.addLast("Ana");          // join the back of the line
waiting.addLast("Ben");
waiting.pollFirst();             // "Ana": removes and returns the front
waiting.pollFirst();             // "Ben"
waiting.pollFirst();             // null: pollFirst returns null when empty
```

`board.contains(task)` on a list of 100,000 tasks checks up to 100,000 elements; `byKey.containsKey(key)` checks about one. Picking the wrong collection is the most common performance bug in everyday Java.

## equals and hashCode, again

`HashSet` and `HashMap` find elements by `hashCode()` first, then confirm with `equals()`. If your class doesn't override them consistently (lesson 4), two "equal" tasks are treated as different, and `set.contains(sameKeyTask)` returns `false`. Records get both for free, which is one reason they make good map keys.

> [!mistake] Mutating a key after inserting it
> If a field used in `hashCode()` changes while the object is in a `HashSet` or used as a `HashMap` key, it's now in the wrong bucket and can't be found. Use immutable keys (Strings, records).

## Modifying while iterating

```java
for (Task b : column) {
    if (!b.isAvailable()) column.remove(b);     // ConcurrentModificationException
}

column.removeIf(b -> !b.isAvailable());         // correct
```

## Unmodifiable collections

`List.of(...)`, `Set.of(...)`, `Map.of(...)` and `List.copyOf(...)` create **unmodifiable** collections: `add` throws `UnsupportedOperationException`. Return them from getters so callers can't change your object's internals (lesson 3's defensive copies).

## Generics

Collections are **generic**: `List<Task>` is a list that the compiler guarantees contains only Tasks, with no casts:

```java
List<Task> tasks = new ArrayList<>();
tasks.add(new Bug(...));       // compile error, caught early
Task b = tasks.get(0);         // no cast needed
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

Repository<Task> tasks = new Repository<>();
Repository<Member> members = new Repository<>();
```

`<T extends Identifiable>` is a **bounded type parameter**: `T` can be any type, as long as it's an `Identifiable`, which is what lets `save` call `item.getId()`.

## Wildcards, briefly

`List<Bug>` is **not** a `List<WorkItem>` (otherwise you could add a `Task` to a list of bugs through it). To accept "a list of any kind of item" for reading, use a wildcard:

```java
static int totalTargetDays(List<? extends Assignable> items) { ... }   // read items out: "extends"
static void addDefaults(List<? super Task> target) { ... }           // put Tasks in: "super"
```

The rule of thumb is **PECS**: Producer `extends`, Consumer `super`.

:::quiz
q: You need to check thousands of times whether a key is in the board. Which collection?
- ArrayList<String>
+ HashSet<String> (or a HashMap keyed by key)
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
q: Is `List<Bug>` a subtype of `List<WorkItem>`?
- yes, because Bug extends WorkItem
+ no; use `List<? extends WorkItem>` to accept both
- only for ArrayList
- only at runtime
why: Generics are invariant; wildcards express covariance safely.
:::

:::exercise
id: jco-index
level: 2
title: Index tasks by ISBN
mode: code
lang: java
file: Index.java
---
Write `static Map<String, Task> byKey(List<Task> tasks)` that builds a `HashMap` from each task's `getKey()` to the task, and returns it.
---starter
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Index {
}
---rule
static\s+Map<String,\s*Task>\s+byKey\(\s*List<Task>\s+tasks\s*\)
The signature
---rule
Map<String,\s*Task>\s+\w+\s*=\s*new\s+HashMap<>\(\s*\)
A new HashMap
---rule
for\s*\(\s*Task\s+(\w+)\s*:\s*tasks\s*\)\s*\{?\s*\w+\.put\(\s*\1\.getKey\(\s*\)\s*,\s*\1\s*\)
Put each task under its key
---rule
return\s+\w+\s*;
Return the map
---solution
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Index {
    static Map<String, Task> byKey(List<Task> tasks) {
        Map<String, Task> index = new HashMap<>();
        for (Task b : tasks) {
            index.put(b.getKey(), b);
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
file: Column.java
---
This method throws `ConcurrentModificationException`. Fix it with `removeIf`.
---starter
import java.util.List;

public class Column {
    static void dropTaken(List<Task> column) {
        for (Task b : column) {
            if (!b.isAvailable()) {
                column.remove(b);
            }
        }
    }
}
---rule
column\.removeIf\(\s*(\w+)\s*->\s*!\s*\1\.isAvailable\(\s*\)\s*\)
`removeIf(b -> !b.isAvailable())`
---rule
!column\.remove\(
No `remove` inside a loop
---solution
import java.util.List;

public class Column {
    static void dropTaken(List<Task> column) {
        column.removeIf(b -> !b.isAvailable());
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
Set<String> assignees = new HashSet<>(List.of("Ana", "Ben", "Ana", "Joyce", "Ben"));
System.out.println(assignees.size());
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
`Key` is a **class** (not a record) that overrides `equals` to compare the value but does **not** override `hashCode`. What does this most likely print: `true` or `false`?

```java
Set<Key> set = new HashSet<>();
set.add(new Key("TB-101"));
System.out.println(set.contains(new Key("TB-101")));
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
path: java/src/main/java/taskboard/Repository.java
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
title: "Project 7b: assignments per member"
mode: code
lang: java
file: AssignmentLog.java
path: java/src/main/java/taskboard/AssignmentLog.java
---
Write a class `AssignmentLog` with `private final Map<String, List<Assignment>> byMember = new HashMap<>()`, a method `record(String memberId, Assignment assignment)` that adds the assignment to that member's list using `byMember.computeIfAbsent(memberId, k -> new ArrayList<>()).add(assignment)`, and `int countFor(String memberId)` returning `byMember.getOrDefault(memberId, List.of()).size()`.
---starter
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
---rule
private\s+final\s+Map<String,\s*List<Assignment>>\s+byMember\s*=\s*new\s+HashMap<>\(\s*\)
The map of lists
---rule
void\s+record\(\s*String\s+memberId\s*,\s*Assignment\s+assignment\s*\)
`record(memberId, assignment)`
---rule
byMember\.computeIfAbsent\(\s*memberId\s*,\s*\w+\s*->\s*new\s+ArrayList<>\(\s*\)\s*\)\.add\(\s*assignment\s*\)
`computeIfAbsent(...).add(assignment)`
---rule
int\s+countFor\(\s*String\s+memberId\s*\)\s*\{\s*return\s+byMember\.getOrDefault\(\s*memberId\s*,\s*List\.of\(\s*\)\s*\)\.size\(\s*\)\s*;
`countFor` with a safe default
---solution
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class AssignmentLog {
    private final Map<String, List<Assignment>> byMember = new HashMap<>();

    public void record(String memberId, Assignment assignment) {
        byMember.computeIfAbsent(memberId, k -> new ArrayList<>()).add(assignment);
    }

    public int countFor(String memberId) {
        return byMember.getOrDefault(memberId, List.of()).size();
    }
}
:::
