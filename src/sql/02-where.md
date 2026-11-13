---
id: sql-where
title: Filtering with WHERE
summary: Comparison operators, AND/OR/NOT and their precedence, IN, BETWEEN, LIKE, and testing for NULL.
minutes: 30
---
> [!project] Desk & Co, step 2: the restock list
> Maya's first real question: *which products are about to run out?* Filtering with `WHERE` answers it. At the end of this lesson you'll write the restock list she sends to her supplier.

## WHERE keeps rows that are true

`WHERE` takes a condition and keeps only the rows where it evaluates to **true**. (Not "not false": that distinction matters once NULL shows up.)

```sql run
SELECT first_name, title, salary
FROM employees
WHERE salary > 100000;
```

## Comparison operators

| Operator | Meaning | Example |
|---|---|---|
| `=` | equal (one `=`, not two) | `city = 'Raleigh'` |
| `<>` or `!=` | not equal | `status <> 'cancelled'` |
| `<` `<=` `>` `>=` | ordering | `gpa >= 3.5` |

Strings go in **single quotes**. Double quotes mean an *identifier* (a column or table name) in standard SQL. SQLite is forgiving about this, but other databases are not, so build the habit now.

```sql run
SELECT name, price FROM products WHERE category = 'Electronics';
```

> [!warn] Case sensitivity
> In SQLite, `=` on text is case-sensitive: `'raleigh' = 'Raleigh'` is false. `LIKE` is case-insensitive for ASCII letters. Other databases differ (MySQL's `=` is usually case-insensitive), so when it matters, normalize with `LOWER()`.

## Combining conditions: AND, OR, NOT

```sql run
SELECT first_name, dept_id, salary, city
FROM employees
WHERE dept_id = 1 AND city = 'Raleigh';
```

**Precedence**: `NOT` binds tightest, then `AND`, then `OR`. That means

```sql
WHERE dept_id = 1 OR dept_id = 3 AND salary > 100000
```

is read as `dept_id = 1 OR (dept_id = 3 AND salary > 100000)`, which is almost never what people mean. Compare these two:

```sql run
SELECT first_name, dept_id, salary FROM employees
WHERE dept_id = 1 OR dept_id = 3 AND salary > 100000;
```

```sql run
SELECT first_name, dept_id, salary FROM employees
WHERE (dept_id = 1 OR dept_id = 3) AND salary > 100000;
```

> [!tip] Rule of thumb
> Whenever a `WHERE` mixes `AND` and `OR`, add parentheses. Even when they're redundant, they document intent.

## IN: a cleaner OR

`x IN (a, b, c)` means `x = a OR x = b OR x = c`.

```sql run
SELECT name, city, state FROM customers WHERE state IN ('TX', 'WA', 'CO');
```

`NOT IN` is the negation, with a nasty NULL trap we'll dissect in the NULL module.

## BETWEEN: inclusive ranges

`x BETWEEN lo AND hi` means `x >= lo AND x <= hi`. **Both ends are included.**

```sql run
SELECT name, price FROM products WHERE price BETWEEN 20 AND 60;
```

Dates in this database are ISO-8601 text (`'2025-03-17'`), which sorts and compares correctly as strings. So date ranges work:

```sql run
SELECT order_id, order_date, status
FROM orders
WHERE order_date BETWEEN '2025-03-01' AND '2025-03-31';
```

> [!warn] BETWEEN and timestamps
> If a column held full timestamps like `'2025-03-31 14:00'`, `BETWEEN '2025-03-01' AND '2025-03-31'` would miss everything on the 31st after midnight. The safe pattern is a half-open range: `>= '2025-03-01' AND < '2025-04-01'`.

## LIKE: pattern matching

| Wildcard | Matches |
|---|---|
| `%` | any sequence of characters, including none |
| `_` | exactly one character |

```sql run
SELECT name FROM products WHERE name LIKE '%desk%';
```

```sql run
SELECT code, title FROM courses WHERE code LIKE 'CSC 2__';
```

`'CSC 2__'` means "CSC 2 followed by exactly two characters". SQLite also has `GLOB`, which uses shell-style `*` and `?` and is case-sensitive: `WHERE code GLOB 'MA *'`.

## Testing for NULL

`NULL` means "unknown / missing". Any comparison with NULL, even `NULL = NULL`, yields NULL (unknown), and `WHERE` drops unknown rows. So **you can't find NULLs with `=`**. Use `IS NULL` / `IS NOT NULL`:

```sql run
SELECT first_name, last_name, city FROM employees WHERE city IS NULL;
```

```sql run
-- Returns nothing! "= NULL" is never true.
SELECT first_name FROM employees WHERE city = NULL;
```

> [!exam] The single most common SQL bug
> `WHERE col = NULL` and `WHERE col <> NULL` both return zero rows. It's always `IS NULL` / `IS NOT NULL`.

## Filtering on expressions

The condition can be any expression:

```sql run
SELECT name, price, stock, price * stock AS value
FROM products
WHERE price * stock > 5000;
```

Notice we repeated `price * stock` rather than writing `WHERE value > 5000`. That's because `WHERE` runs before `SELECT` computes the alias. (SQLite actually tolerates the alias as an extension, but most databases reject it.)

## Worked example: building a filter one condition at a time

Write complex filters **incrementally** and run each step. Suppose Maya asks for "Electronics or Accessories that cost under $50 and have fewer than 50 in stock".

Step 1, the category part:

```sql run
SELECT name, category, price, stock FROM products
WHERE category IN ('Electronics', 'Accessories');
```

Step 2, add the price. Check the row count drops the way you expect:

```sql run
SELECT name, category, price, stock FROM products
WHERE category IN ('Electronics', 'Accessories')
  AND price < 50;
```

Step 3, add the stock condition:

```sql run
SELECT name, category, price, stock FROM products
WHERE category IN ('Electronics', 'Accessories')
  AND price < 50
  AND stock < 50;
```

Putting each condition on its own line makes the query read like the requirement, and it's easy to comment one out while debugging.

> [!plain] In plain English
> `WHERE` is a test that runs once per row. Rows where the test is **true** stay; rows where it's false (or unknown, because of NULL) are dropped.

## Common mistakes

> [!mistake] Mixing AND and OR without parentheses
> `WHERE category = 'Home' OR category = 'Furniture' AND price > 100` means `Home OR (Furniture AND price > 100)`, because `AND` binds tighter than `OR`. If you meant "(Home or Furniture) and expensive", write the parentheses, or use `IN`.

> [!mistake] Comparing with NULL using `=`
> `WHERE email = NULL` never matches anything. Use `IS NULL` / `IS NOT NULL`. The NULL lesson explains why.

- `BETWEEN 10 AND 50` **includes** both ends.
- `LIKE 'desk%'` in SQLite is case-insensitive for ASCII letters; `%` matches any run of characters, `_` exactly one.
- Dates stored as `'YYYY-MM-DD'` text compare correctly as strings: `order_date >= '2025-06-01'`.

:::quiz
q: Which rows does `WHERE a = 1 OR b = 2 AND c = 3` keep?
- rows where (a = 1 OR b = 2) and c = 3
+ rows where a = 1, plus rows where both b = 2 and c = 3
- rows where all three conditions hold
- it's a syntax error without parentheses
why: AND binds tighter than OR, so it's `a = 1 OR (b = 2 AND c = 3)`.
:::

:::quiz
q: `price BETWEEN 10 AND 20` keeps a product priced exactly 20?
+ Yes, BETWEEN includes both endpoints
- No, the upper bound is exclusive
- Only if price is an integer
- Only in SQLite
why: BETWEEN is inclusive on both ends: `price >= 10 AND price <= 20`.
:::

:::quiz
q: Which pattern matches `'CSC 216'` but not `'CSC 2160'`?
- `'CSC 2%'`
+ `'CSC 2__'`
- `'CSC_2%'`
- `'%216%'`
why: Each `_` matches exactly one character, so `'CSC 2__'` requires exactly two characters after "CSC 2".
:::

:::quiz
q: What does `SELECT * FROM t WHERE x <> NULL` return?
- every row where x has a value
- every row
+ no rows
- rows where x is NULL
why: Any comparison with NULL is unknown, and WHERE only keeps true. Use `x IS NOT NULL`.
:::

:::quiz
q: Which literal is a string in standard SQL?
+ `'Raleigh'`
- `"Raleigh"`
- `[Raleigh]`
- `Raleigh`
why: Single quotes delimit strings. Double quotes delimit identifiers (column/table names).
:::

:::exercise
id: wh-raleigh
level: 1
title: Raleigh staff
---
List `first_name`, `last_name` and `title` for every employee whose `city` is Raleigh.
---solution
SELECT first_name, last_name, title FROM employees WHERE city = 'Raleigh';
:::

:::exercise
id: wh-cheap
level: 1
title: Under twenty bucks
---
Show the `name` and `price` of products that cost less than $20.
---solution
SELECT name, price FROM products WHERE price < 20;
:::

:::exercise
id: wh-out-of-stock
level: 1
title: Out of stock
---
Which products have zero `stock`? Return their `name`.
---solution
SELECT name FROM products WHERE stock = 0;
:::

:::exercise
id: wh-cs-honors
level: 2
title: Dean's list candidates
---
Return `first_name`, `last_name` and `gpa` of **Computer Science** majors with a GPA of at least 3.5.
---hint
Two conditions joined by AND.
---solution
SELECT first_name, last_name, gpa FROM students WHERE major = 'Computer Science' AND gpa >= 3.5;
:::

:::exercise
id: wh-in-states
level: 2
title: Out-of-state customers
---
List `name` and `state` of customers who are **not** in North Carolina (`NC`).
---hint
`<>` or `!=` both work.
---solution
SELECT name, state FROM customers WHERE state <> 'NC';
:::

:::exercise
id: wh-missing-email
level: 2
title: Who has no email?
---
Find employees whose `email` is missing. Return `first_name` and `last_name`.
---hint
`= NULL` never matches anything.
---solution
SELECT first_name, last_name FROM employees WHERE email IS NULL;
:::

:::exercise
id: wh-between-hires
level: 2
title: The 2018–2020 hiring wave
---
List `first_name`, `last_name` and `hire_date` for employees hired from **2018-01-01 through 2020-12-31** inclusive.
---solution
SELECT first_name, last_name, hire_date FROM employees WHERE hire_date BETWEEN '2018-01-01' AND '2020-12-31';
:::

:::exercise
id: wh-like-engineer
level: 2
title: Anyone with "Engineer" in the title
---
Return `first_name` and `title` for every employee whose title contains the word `Engineer` anywhere (Senior Engineer, Support Engineer, and so on).
---hint
`LIKE '%…%'`
---solution
SELECT first_name, title FROM employees WHERE title LIKE '%Engineer%';
:::

:::exercise
id: wh-precedence
level: 3
title: Fix the precedence bug
---
A teammate wrote this to find **Electronics or Home** products that are **in stock**:

```sql
SELECT name, category, stock FROM products
WHERE category = 'Electronics' OR category = 'Home' AND stock > 0;
```

It returns an out-of-stock item. Write a corrected query returning the same three columns.
---hint
Which operator binds tighter, AND or OR?
---hint
Wrap the OR in parentheses, or use IN.
---solution
SELECT name, category, stock FROM products WHERE category IN ('Electronics', 'Home') AND stock > 0;
:::

:::exercise
id: wh-500-level
level: 3
title: Upper-level CSC courses
---
Find courses whose `code` starts with `CSC` followed by a **3-digit number starting with 3 or 4** (e.g. `CSC 316`, `CSC 440`). Return `code` and `title`.
---hint
Two LIKE patterns with OR, or `GLOB 'CSC [34]*'`.
---solution
SELECT code, title FROM courses WHERE code LIKE 'CSC 3__' OR code LIKE 'CSC 4__';
:::

:::exercise
id: wh-orders-q2
level: 3
title: Second-quarter orders that went out
---
Return `order_id`, `order_date` and `status` for orders placed in **April through June 2025** that were **not cancelled**.
---hint
Use a half-open range on the date: `>= '2025-04-01' AND < '2025-07-01'`.
---solution
SELECT order_id, order_date, status FROM orders
WHERE order_date >= '2025-04-01' AND order_date < '2025-07-01' AND status <> 'cancelled';
:::

:::exercise
id: wh-complex
level: 4
title: Targeted outreach list
---
Marketing wants students who are either:

- **seniors** (`year = 4`) with a GPA **above 3.5**, or
- any **first-years** (`year = 1`) majoring in **Computer Science or Computer Engineering**,

and in both cases **must have an email**. Return `first_name`, `last_name`, `year`, `major` and `gpa`.
---hint
Structure: `(senior condition OR first-year condition) AND email IS NOT NULL`.
---hint
The major check can be `major IN ('Computer Science', 'Computer Engineering')`.
---solution
SELECT first_name, last_name, year, major, gpa FROM students
WHERE ((year = 4 AND gpa > 3.5)
    OR (year = 1 AND major IN ('Computer Science', 'Computer Engineering')))
  AND email IS NOT NULL;
:::

:::exercise
id: proj-sql-02-restock
level: 2
title: "Project 2: the restock list"
---
List the `name`, `category` and `stock` of every product with **fewer than 20** units in stock, **excluding** the `Stationery` category (Maya restocks that locally).
---hint
Two conditions joined with `AND`; "excluding" is `<>` (or `!=`).
---solution
SELECT name, category, stock FROM products WHERE stock < 20 AND category <> 'Stationery';
:::

:::exercise
id: proj-sql-02-open-orders
level: 2
title: "Project 2b: orders still in flight"
---
Maya wants to see every order that hasn't reached the customer yet: show `order_id`, `customer_id`, `order_date` and `status` for orders whose status is `pending` or `shipped` and that were placed **on or after** `2025-09-01`.
---solution
SELECT order_id, customer_id, order_date, status FROM orders WHERE status IN ('pending', 'shipped') AND order_date >= '2025-09-01';
:::
