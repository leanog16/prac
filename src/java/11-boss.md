---
id: java-boss
title: Boss round: model it yourself
summary: Interview-style object-oriented design problems: model a domain from a description, refactor procedural code into objects, spot design flaws, and predict tricky outputs involving references, overriding, equality and statics.
minutes: 60
---
> [!project] Bookshelf, final step: reservations
> Apply the design process to Bookshelf's reservation and queue rules in the Project exercises. Each answer is checked independently; use the earlier lessons as references.

## How to approach an OO design question

Interviewers rarely want "the" answer; they want to see a process:

1. **Find the nouns** in the requirements: candidate classes and fields. ("A *member* *borrows* an *item*; a *loan* has a *due date*.")
2. **Find the verbs**: candidate methods, and decide **which object owns each one**. (Who knows enough to compute a fee? The loan: it has the due date.)
3. **Find the rules** (invariants): enforce them in constructors and methods, not in callers.
4. **Find what varies**: put an interface around it (fee rules, notifications, storage).
5. **Check the relationships**: is-a (inheritance, rarely), has-a (composition, usually), uses (parameters).
6. **Walk through a scenario** with your classes ("Ada borrows Dune…") and fix what's awkward.

## Worked example: a parking garage, in five minutes

> "A garage has levels with spots of three sizes (motorcycle, compact, large). Vehicles park in the smallest spot that fits. Tickets record entry time; fees are hourly and differ by vehicle type."

- Nouns → `Garage`, `Level`, `Spot`, `Vehicle` (`Motorcycle`, `Car`, `Bus`), `Ticket`.
- What varies → vehicle size (an enum `Size`), fee rules (`PricingStrategy`).
- Ownership → `Spot.canFit(Vehicle)`; `Level.findSpot(Vehicle)`; `Garage.park(Vehicle)` returns a `Ticket`; `Ticket.fee(exitTime, pricing)`.
- Rule → a spot holds at most one vehicle: `Spot.occupy()` throws if occupied.

Being able to talk through that structure clearly matters more than any particular class diagram.

:::exercise
id: proj-java-11-reservation
level: 4
title: "Project 11: reservations"
mode: code
lang: java
file: Reservation.java
---
Members can reserve an item that's on loan. Write an immutable `Reservation` **record** with components `String itemId`, `String memberName` and `LocalDate placedOn`, and a compact constructor that throws `IllegalArgumentException("itemId is required")` when `itemId` is null or blank, and uses `Objects.requireNonNull(placedOn, "placedOn")`. Add a method `boolean isExpired(LocalDate today)` returning `today.isAfter(placedOn.plusDays(7))`.
---starter
import java.time.LocalDate;
import java.util.Objects;
---rule
public\s+record\s+Reservation\(\s*String\s+itemId\s*,\s*String\s+memberName\s*,\s*LocalDate\s+placedOn\s*\)
The record
---rule
public\s+Reservation\s*\{
Compact constructor
---rule
itemId\s*==\s*null\s*\|\|\s*itemId\.isBlank\(\s*\)[\s\S]*?throw\s+new\s+IllegalArgumentException\(\s*"itemId is required"\s*\)
Validate the item id
---rule
Objects\.requireNonNull\(\s*placedOn\s*,\s*"placedOn"\s*\)
Require a date
---rule
boolean\s+isExpired\(\s*LocalDate\s+today\s*\)\s*\{\s*return\s+today\.isAfter\(\s*placedOn\.plusDays\(\s*7\s*\)\s*\)\s*;
`isExpired`
---solution
import java.time.LocalDate;
import java.util.Objects;

public record Reservation(String itemId, String memberName, LocalDate placedOn) {
    public Reservation {
        if (itemId == null || itemId.isBlank()) {
            throw new IllegalArgumentException("itemId is required");
        }
        Objects.requireNonNull(placedOn, "placedOn");
    }

    public boolean isExpired(LocalDate today) {
        return today.isAfter(placedOn.plusDays(7));
    }
}
:::

:::exercise
id: proj-java-11-queue
level: 4
title: "Project 11b: a waiting list"
mode: code
lang: java
file: WaitingList.java
---
Write `WaitingList` that keeps reservations per item in arrival order: a `private final Map<String, Deque<Reservation>> queues = new HashMap<>()`; `void add(Reservation r)` appending to `queues.computeIfAbsent(r.itemId(), k -> new ArrayDeque<>())`; and `Optional<Reservation> next(String itemId)` that removes and returns the first reservation (`pollFirst()`), or `Optional.empty()` if there's no queue.
---starter
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
---rule
private\s+final\s+Map<String,\s*Deque<Reservation>>\s+queues\s*=\s*new\s+HashMap<>\(\s*\)
A map of deques
---rule
void\s+add\(\s*Reservation\s+r\s*\)
`add`
---rule
queues\.computeIfAbsent\(\s*r\.itemId\(\s*\)\s*,\s*\w+\s*->\s*new\s+ArrayDeque<>\(\s*\)\s*\)\.(addLast|add|offerLast|offer)\(\s*r\s*\)
Append in arrival order
---rule
Optional<Reservation>\s+next\(\s*String\s+itemId\s*\)
`next`
---rule
\.pollFirst\(\s*\)
Take the first one
---rule
Optional\.empty\(\s*\)|Optional\.ofNullable\(
Handle the empty case
---solution
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public class WaitingList {
    private final Map<String, Deque<Reservation>> queues = new HashMap<>();

    public void add(Reservation r) {
        queues.computeIfAbsent(r.itemId(), k -> new ArrayDeque<>()).addLast(r);
    }

    public Optional<Reservation> next(String itemId) {
        Deque<Reservation> q = queues.get(itemId);
        if (q == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(q.pollFirst());
    }
}
:::

:::exercise
id: jboss-refactor
level: 4
title: Refactor procedural code
mode: code
lang: java
file: Shipping.java
---
This method decides shipping cost with a type string. Refactor it into a `ShippingMethod` **interface** with `BigDecimal cost(BigDecimal weightKg)`, implemented by `Standard` (`new BigDecimal("4.99")`), `Express` (`new BigDecimal("9.99").add(weightKg)`) and `Pickup` (`BigDecimal.ZERO`). Remove the string switch.
---starter
import java.math.BigDecimal;

public class Shipping {
    static BigDecimal cost(String method, BigDecimal weightKg) {
        if (method.equals("standard")) return new BigDecimal("4.99");
        if (method.equals("express")) return new BigDecimal("9.99").add(weightKg);
        if (method.equals("pickup")) return BigDecimal.ZERO;
        throw new IllegalArgumentException(method);
    }
}
---rule
interface\s+ShippingMethod\s*\{\s*BigDecimal\s+cost\(\s*BigDecimal\s+weightKg\s*\)\s*;
The interface
---rule
class\s+Standard\s+implements\s+ShippingMethod[\s\S]*?return\s+new\s+BigDecimal\(\s*"4\.99"\s*\)
Standard
---rule
class\s+Express\s+implements\s+ShippingMethod[\s\S]*?return\s+new\s+BigDecimal\(\s*"9\.99"\s*\)\.add\(\s*weightKg\s*\)
Express
---rule
class\s+Pickup\s+implements\s+ShippingMethod[\s\S]*?return\s+BigDecimal\.ZERO
Pickup
---rule
!method\.equals\(
No string comparisons
---solution
import java.math.BigDecimal;

interface ShippingMethod {
    BigDecimal cost(BigDecimal weightKg);
}

class Standard implements ShippingMethod {
    public BigDecimal cost(BigDecimal weightKg) { return new BigDecimal("4.99"); }
}

class Express implements ShippingMethod {
    public BigDecimal cost(BigDecimal weightKg) { return new BigDecimal("9.99").add(weightKg); }
}

class Pickup implements ShippingMethod {
    public BigDecimal cost(BigDecimal weightKg) { return BigDecimal.ZERO; }
}
:::

:::exercise
id: jboss-predict-1
level: 4
title: Predict: fields aren't polymorphic
mode: answer
---
```java
class A { String name = "A"; String who() { return name; } }
class B extends A { String name = "B"; @Override String who() { return name; } }

A x = new B();
System.out.println(x.name + x.who());
```

What does it print?
---answer
AB
---solution
AB
---explain
Fields are resolved by the **static** type (`A`, so `x.name` is "A"); overridden methods by the **dynamic** type (`B.who()` returns B's field). Another reason to keep fields private.
:::

:::exercise
id: jboss-predict-2
level: 4
title: Predict: Integer caching
mode: answer
---
```java
Integer a = 127, b = 127, c = 128, d = 128;
System.out.println((a == b) + " " + (c == d) + " " + c.equals(d));
```

What does it print?
---answer
true false true
---solution
true false true
---explain
Java caches boxed Integers from −128 to 127, so `a` and `b` are the same object; 128 creates two objects. Always compare objects with `equals`.
:::

:::exercise
id: jboss-predict-3
level: 4
title: Predict: pass by value
mode: answer
---
```java
static void rename(Member m) { m = new Member("Grace", "g@x"); }
static void addOne(Member m) { m.addLoan(); }

Member ada = new Member("Ada", "a@x");
rename(ada);
addOne(ada);
System.out.println(ada.getName() + " " + ada.getLoans());
```

What does it print?
---answer
Ada 1
---solution
Ada 1
---explain
Java passes references **by value**: reassigning the parameter doesn't affect the caller's variable, but calling a method through it changes the shared object.
:::

:::exercise
id: jboss-flaw
level: 3
title: Spot the flaw
mode: answer
---
```java
public class Account {
    public double balance;
    public void withdraw(double amount) { balance -= amount; }
}
```

Name the OOP principle this class violates most clearly (one word), given that any code can set `balance` directly and overdraw it.
---answer
encapsulation
---answer
no encapsulation
---answer
broken encapsulation
---solution
encapsulation
---explain
Public mutable state plus no invariant checks. Make `balance` private, validate in `withdraw`, and use `BigDecimal` for money.
:::
