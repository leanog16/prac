---
id: java-basics
title: Java essentials
summary: How a Java program is structured, compiled and run; primitive and reference types; variables, operators and strings; if, switch and loops; methods with parameters and return values; arrays; and reading compiler errors. Everything OOP builds on.
minutes: 35
---
> [!project] Track project: Bookshelf, a library system in plain Java
> Through this track you'll model a small public library in Java: books and other items, members, loans, fees, a catalog you can search, and reports. You start with a single `Main` class and end with a clean, tested object-oriented design using interfaces, collections, exceptions, streams and design patterns. (The Spring Boot track later turns this same domain into a web API.) Each lesson ends with **Project** exercises that add the next piece.

## Your first program

```java title=Main.java
public class Main {
    public static void main(String[] args) {
        System.out.println("Welcome to Bookshelf");
    }
}
```

```bash
javac Main.java      # compile: Main.java → Main.class (bytecode)
java Main            # run: the JVM loads Main.class and calls main
```

Since Java 11 you can also run a single file directly: `java Main.java`.

Every piece of that program matters:

| Part | Meaning |
|---|---|
| `public class Main` | all Java code lives inside a **class**; a public class must be in a file of the same name |
| `public static void main(String[] args)` | the entry point the JVM calls: `public` (callable from outside), `static` (no object needed), `void` (returns nothing), `args` (command-line arguments) |
| `System.out.println(...)` | print a line to standard output |
| `;` | every statement ends with a semicolon |
| `{ }` | braces group code into blocks |

> [!plain] In plain English
> Java code is written in `.java` files, compiled once into `.class` files of **bytecode**, and run by the **JVM** (Java Virtual Machine). That's why the same compiled program runs on Windows, macOS and Linux.

## Types and variables

Java is **statically typed**: every variable has a type, fixed when you declare it, and the compiler checks every use.

```java
int copies = 3;                    // whole numbers (32-bit)
long isbn = 9780441013593L;        // big whole numbers (64-bit): note the L
double price = 9.99;               // decimals (approximate!)
boolean available = true;          // true / false
char grade = 'A';                  // one character, single quotes
String title = "Dune";             // text, double quotes (a class, not a primitive)

var author = "Frank Herbert";      // Java 10+: the compiler infers String
final int maxLoans = 5;            // final: can't be reassigned
```

| Kind | Types | Holds | Default for fields |
|---|---|---|---|
| **primitive** | `int`, `long`, `double`, `boolean`, `char`, `byte`, `short`, `float` | the value itself | `0`, `false` |
| **reference** | `String`, arrays, every class you write | a **reference** (arrow) to an object | `null` |

The difference matters constantly: copying a primitive copies the value; copying a reference copies the arrow, so both variables point at the **same** object.

## Operators and strings

```java
int total = 7 / 2;          // 3: integer division drops the fraction
double avg = 7 / 2.0;       // 3.5: one double makes it decimal division
int rest = 7 % 2;           // 1: remainder
copies++;                   // copies = copies + 1
boolean ok = copies > 0 && available;    // && and, || or, ! not

String s = "Dune" + " by " + author;     // + concatenates strings
s.length();  s.toUpperCase();  s.contains("by");  s.substring(0, 4);
String.format("%s (%d)", title, 1965);   // "Dune (1965)"
```

> [!mistake] Comparing strings with ==
> `==` on references asks "is it the **same object**?", not "same text?". `new String("a") == "a"` is `false`. Always compare text with `a.equals(b)` (or `a.equalsIgnoreCase(b)`).

## Control flow

```java
if (copies == 0) {
    System.out.println("Out of stock");
} else if (copies < 3) {
    System.out.println("Only " + copies + " left");
} else {
    System.out.println("Available");
}

String label = switch (genre) {           // switch expression (Java 14+)
    case "SF", "FANTASY" -> "Speculative";
    case "BIO" -> "Non-fiction";
    default -> "Other";
};

for (int i = 1; i <= 3; i++) {            // counted loop
    System.out.println("Copy " + i);
}

int days = 0;
while (days < 14) {                       // loop while a condition holds
    days += 7;
}
```

## Methods

A **method** is a named, reusable piece of logic with typed parameters and a return type:

```java
static double lateFee(int daysLate, double perDay) {
    if (daysLate <= 0) {
        return 0;
    }
    return daysLate * perDay;
}

double fee = lateFee(3, 0.25);   // 0.75
```

`static` methods belong to the class; you call them without creating an object. In the next lesson you'll write **instance** methods, which belong to objects, and that's where OOP begins.

## Arrays

```java
String[] titles = {"Dune", "Emma", "Ulysses"};
titles.length;          // 3
titles[0];              // "Dune"  (indexes start at 0)
titles[3];              // throws ArrayIndexOutOfBoundsException

for (String t : titles) {       // enhanced for: each element in turn
    System.out.println(t);
}
```

Arrays have a fixed size. For growing lists you'll use `ArrayList` (lesson 7).

## Reading compiler errors

```
Main.java:5: error: incompatible types: String cannot be converted to int
        int copies = "three";
                     ^
```

The compiler tells you the **file**, the **line**, the **problem** and points at the spot. Fix the **first** error first: later errors are often caused by it.

:::quiz
q: What does `javac Main.java` produce?
- a native executable
+ `Main.class`, containing bytecode for the JVM
- `Main.jar`
- nothing; it runs the program
why: javac compiles source to bytecode; `java` runs it on the JVM.
:::

:::quiz
q: What is `7 / 2` in Java?
- 3.5
+ 3
- 4
- a compile error
why: Both operands are ints, so it's integer division.
:::

:::quiz
q: How should you check whether two Strings contain the same text?
- `a == b`
+ `a.equals(b)`
- `a = b`
- `a.compareTo(b) == true`
why: `==` compares references (same object?), equals compares content.
:::

:::quiz
q: What's the default value of an uninitialized `String` field?
- `""`
- `"null"`
+ `null`
- it doesn't compile
why: Reference-type fields default to null; primitives default to 0 or false.
:::

:::exercise
id: jb-fee
level: 1
title: A late-fee method
mode: code
lang: java
file: Fees.java
---
Write `static double lateFee(int daysLate, double perDay)` that returns `0` when `daysLate` is 0 or less, and `daysLate * perDay` otherwise.
---starter
public class Fees {
}
---rule
static\s+double\s+lateFee\(\s*int\s+daysLate\s*,\s*double\s+perDay\s*\)
The signature
---rule
if\s*\(\s*daysLate\s*<=\s*0\s*\)\s*\{?\s*return\s+0(\.0)?\s*;
Return 0 when not late
---rule
return\s+daysLate\s*\*\s*perDay\s*;
Multiply otherwise
---solution
public class Fees {
    static double lateFee(int daysLate, double perDay) {
        if (daysLate <= 0) {
            return 0;
        }
        return daysLate * perDay;
    }
}
:::

:::exercise
id: jb-label
level: 2
title: A switch expression
mode: code
lang: java
file: Genres.java
---
Write `static String shelf(String genre)` using a **switch expression** that returns `"Speculative"` for `"SF"` or `"FANTASY"`, `"Non-fiction"` for `"BIO"` or `"HISTORY"`, and `"General"` otherwise.
---starter
public class Genres {
}
---rule
static\s+String\s+shelf\(\s*String\s+genre\s*\)
The signature
---rule
return\s+switch\s*\(\s*genre\s*\)|=\s*switch\s*\(\s*genre\s*\)
A switch expression on `genre`
---rule
case\s+"SF"\s*,\s*"FANTASY"\s*->\s*"Speculative"
Speculative fiction
---rule
case\s+"BIO"\s*,\s*"HISTORY"\s*->\s*"Non-fiction"
Non-fiction
---rule
default\s*->\s*"General"
Default
---solution
public class Genres {
    static String shelf(String genre) {
        return switch (genre) {
            case "SF", "FANTASY" -> "Speculative";
            case "BIO", "HISTORY" -> "Non-fiction";
            default -> "General";
        };
    }
}
:::

:::exercise
id: jb-predict-int
level: 1
title: Predict: integer division
mode: answer
---
```java
int pages = 350;
int perDay = 40;
System.out.println(pages / perDay);
```

What does it print?
---answer
8
---solution
8
:::

:::exercise
id: jb-predict-ref
level: 2
title: Predict: references
mode: answer
---
```java
int[] a = {1, 2, 3};
int[] b = a;
b[0] = 99;
System.out.println(a[0]);
```

What does it print?
---answer
99
---solution
99
---explain
`b = a` copies the **reference**, so both variables point at the same array.
:::

:::exercise
id: jb-predict-string
level: 2
title: Predict: string building
mode: answer
---
```java
String s = "Book" + 1 + 2;
String t = 1 + 2 + "Book";
System.out.println(s + " " + t);
```

What does it print?
---answer
Book12 3Book
---solution
Book12 3Book
---explain
`+` is evaluated left to right. Once a String is involved, `+` concatenates; before that, `1 + 2` is arithmetic.
:::

:::exercise
id: proj-java-01-main
level: 1
title: "Project 1: Bookshelf's entry point"
mode: code
lang: java
file: Main.java
---
Write `Main` with a `main` method that stores `"Bookshelf"` in a `String` variable `name` and the number of books `3` in an `int` variable `books`, and prints `Bookshelf has 3 books` using those variables.
---starter
public class Main {
}
---rule
public\s+static\s+void\s+main\(\s*String\s*\[\]\s*args\s*\)
The `main` method
---rule
String\s+name\s*=\s*"Bookshelf"\s*;
`String name = "Bookshelf";`
---rule
int\s+books\s*=\s*3\s*;
`int books = 3;`
---rule
System\.out\.println\(\s*name\s*\+\s*" has "\s*\+\s*books\s*\+\s*" books"\s*\)
Print using the variables
---solution
public class Main {
    public static void main(String[] args) {
        String name = "Bookshelf";
        int books = 3;
        System.out.println(name + " has " + books + " books");
    }
}
:::

:::exercise
id: proj-java-01-titles
level: 2
title: "Project 1b: list the titles"
mode: code
lang: java
file: Main.java
---
In `main`, create a `String[] titles` with `"Dune"`, `"Emma"` and `"Ulysses"`, and print each one with an **enhanced for** loop, followed by a final line `3 titles` using `titles.length`.
---starter
public class Main {
    public static void main(String[] args) {
    }
}
---rule
String\s*\[\]\s+titles\s*=\s*\{\s*"Dune"\s*,\s*"Emma"\s*,\s*"Ulysses"\s*\}
The array
---rule
for\s*\(\s*String\s+(\w+)\s*:\s*titles\s*\)\s*\{?\s*System\.out\.println\(\s*\1\s*\)
Enhanced for loop printing each title
---rule
System\.out\.println\(\s*titles\.length\s*\+\s*" titles"\s*\)
Print the count
---solution
public class Main {
    public static void main(String[] args) {
        String[] titles = {"Dune", "Emma", "Ulysses"};
        for (String t : titles) {
            System.out.println(t);
        }
        System.out.println(titles.length + " titles");
    }
}
:::
