---
id: sql-sets
title: Set operations
summary: Stacking result sets with UNION and UNION ALL, and comparing them with INTERSECT and EXCEPT.
minutes: 15
---
> [!project] Desk & Co, step 10: one contact list
> Maya's newsletter goes to customers **and** to her staff, and she wants to know which products are stocked but never sold. Set operations stack and compare whole result sets.

## Combining results vertically

Joins combine tables *side by side* (more columns). Set operations stack results *on top of each other* (more rows), or compare them.

| Operator | Result | Duplicates |
|---|---|---|
| `UNION` | rows in either query | removed |
| `UNION ALL` | rows in either query | kept (faster: no dedup step) |
| `INTERSECT` | rows in both queries | removed |
| `EXCEPT` | rows in the first but not the second (`MINUS` in Oracle) | removed |

The rules:

1. Both queries must return the **same number of columns**, with compatible types.
2. Column **names come from the first query**.
3. One `ORDER BY` goes at the very end and sorts the combined result.

```sql run
-- every city that appears anywhere in the company or store
SELECT city FROM employees WHERE city IS NOT NULL
UNION
SELECT city FROM customers
ORDER BY city;
```

## UNION vs UNION ALL

```sql run
SELECT 'employee' AS kind, city FROM employees WHERE city = 'Durham'
UNION ALL
SELECT 'customer', city FROM customers WHERE city = 'Durham';
```

Use `UNION ALL` unless you specifically need duplicates removed. A literal column like `'employee' AS kind` is the standard way to label which branch a row came from.

## INTERSECT and EXCEPT

```sql run
-- cities with both employees and customers
SELECT city FROM employees
INTERSECT
SELECT city FROM customers;
```

```sql run
-- customer cities where we have no employees
SELECT city FROM customers
EXCEPT
SELECT city FROM employees;
```

> [!tip] Set ops and NULL
> Unlike `=`, set operations treat two NULLs as equal (like DISTINCT does). So `EXCEPT` is another NULL-safe way to compute "in A but not B".

## When to reach for them

- Combining similar data from different tables (a "people" list from students and employees).
- Turning columns into rows ("unpivot"): one SELECT per column, glued with UNION ALL.
- Comparing two query results while testing: `(A EXCEPT B)` and `(B EXCEPT A)` both empty means they match.

```sql run
-- unpivot: one row per (product, metric)
SELECT name, 'price' AS metric, price AS value FROM products WHERE category = 'Furniture'
UNION ALL
SELECT name, 'stock', stock FROM products WHERE category = 'Furniture'
ORDER BY name, metric;
```

## Worked example: stacking two different tables

`UNION` needs the same **number** of columns, with compatible types, in the same **order**. Column names come from the first query. Label each source so the merged list stays understandable:

```sql run
SELECT name, email, 'customer' AS kind FROM customers WHERE email IS NOT NULL
UNION ALL
SELECT first_name || ' ' || last_name, email, 'staff' FROM employees WHERE email IS NOT NULL
ORDER BY kind, name
LIMIT 10;
```

- `UNION ALL` keeps every row (fast, no duplicate check).
- `UNION` removes duplicate rows (it has to sort or hash everything to find them).
- `ORDER BY` goes **once, at the very end**, and applies to the combined result.

## EXCEPT as "in A but not in B"

```sql run
SELECT product_id FROM products
EXCEPT
SELECT product_id FROM order_items;
```

Compared with the anti-join from lesson 8, `EXCEPT` is shorter but compares **whole rows**: you can only return columns that exist in both queries. When you need extra columns, use `NOT EXISTS`.

> [!plain] In plain English
> Joins glue tables **side by side** (more columns). Set operations stack results **on top of each other** (more rows) or compare them.

## Common mistakes

> [!mistake] Columns in the wrong order
> `SELECT name, email … UNION SELECT email, name …` runs without error and produces garbage: names and emails swapped in half the rows. SQL matches columns by **position**, not by name.

:::quiz
q: `SELECT a, b FROM t1 UNION SELECT c FROM t2` fails because…
- UNION requires the same table
+ the two queries return different numbers of columns
- c must be named a
- UNION needs ORDER BY
why: Every branch must produce the same number of (type-compatible) columns.
:::

:::quiz
q: Query A returns {1, 2, 2, 3}; query B returns {2, 4}. What does `A UNION ALL B` return?
- {1, 2, 3, 4}
+ {1, 2, 2, 3, 2, 4}
- {2}
- {1, 3}
why: UNION ALL keeps every row from both. UNION would give {1, 2, 3, 4}.
:::

:::quiz
q: Same A and B. What is `A EXCEPT B`?
+ {1, 3}
- {1, 2, 3}
- {4}
- {1, 3, 4}
why: Rows of A not found in B, deduplicated.
:::

:::quiz
q: Where does ORDER BY go in a UNION query?
- After each SELECT
+ Once, at the end, applying to the combined result
- Before the first SELECT
- ORDER BY isn't allowed
why: The final ORDER BY sorts the whole set result.
:::

:::exercise
id: so-all-people
level: 1
title: Everyone's first name
---
Return one column `first_name` listing the distinct first names of all employees **and** all students combined.
---solution
SELECT first_name FROM employees UNION SELECT first_name FROM students;
:::

:::exercise
id: so-shared-names
level: 2
title: Name twins
---
Which first names belong to **both** an employee and a student? Return `first_name`.
---solution
SELECT first_name FROM employees INTERSECT SELECT first_name FROM students;
:::

:::exercise
id: so-labelled
level: 2
title: Labelled directory
---
Build a directory of everyone in **Durham**: columns `kind` (`'employee'` or `'customer'`) and `name` (employee first and last name joined with a space, or the customer's name). Keep everyone, including duplicates.
---solution
SELECT 'employee' AS kind, first_name || ' ' || last_name AS name FROM employees WHERE city = 'Durham'
UNION ALL
SELECT 'customer', name FROM customers WHERE city = 'Durham';
:::

:::exercise
id: so-except-products
level: 2
title: Unsold products, the set way
---
Return the `product_id` of products that have never been ordered, using `EXCEPT`.
---solution
SELECT product_id FROM products EXCEPT SELECT product_id FROM order_items;
:::

:::exercise
id: so-sorted-union
level: 3
title: Contact list
ordered: true
---
Produce a single sorted list of all non-NULL **emails** from employees and customers (no duplicates), alphabetically. One column, `email`.
---solution
SELECT email FROM employees WHERE email IS NOT NULL
UNION
SELECT email FROM customers WHERE email IS NOT NULL
ORDER BY email;
:::

:::exercise
id: so-unpivot
level: 3
title: Unpivot salary stats
---
Return rows of `(stat, value)` for the employees table: `('min', …)`, `('max', …)`, `('avg', …)` where avg is rounded to whole dollars. Three rows.
---solution
SELECT 'min' AS stat, MIN(salary) AS value FROM employees
UNION ALL SELECT 'max', MAX(salary) FROM employees
UNION ALL SELECT 'avg', ROUND(AVG(salary)) FROM employees;
:::

:::exercise
id: so-both-terms
level: 3
title: Fall and spring
---
Return `student_id`s of students enrolled in **both** `Fall 2025` and `Spring 2026`.
---solution
SELECT student_id FROM enrollments WHERE term = 'Fall 2025'
INTERSECT
SELECT student_id FROM enrollments WHERE term = 'Spring 2026';
:::

:::exercise
id: so-symmetric-diff
level: 4
title: Symmetric difference
---
Return the cities that appear in **exactly one** of `customers.city` or `employees.city` (not both). Ignore NULLs. One column, `city`.
---hint
(A EXCEPT B) UNION (B EXCEPT A). SQLite needs each part wrapped as a subquery to combine them.
---solution
SELECT city FROM (SELECT city FROM customers EXCEPT SELECT city FROM employees)
UNION
SELECT city FROM (SELECT city FROM employees WHERE city IS NOT NULL EXCEPT SELECT city FROM customers);
:::

:::exercise
id: proj-sql-10-contacts
level: 2
title: "Project 10: the newsletter list"
---
Produce one list with columns `name` and `email`: customers (their `name`) and employees (`first_name || ' ' || last_name`), only where the email isn't NULL. Remove duplicates.
---solution
SELECT name, email FROM customers WHERE email IS NOT NULL UNION SELECT first_name || ' ' || last_name, email FROM employees WHERE email IS NOT NULL;
:::

:::exercise
id: proj-sql-10-never-sold
level: 2
title: "Project 10b: never sold, with EXCEPT"
---
Using `EXCEPT`, return the `product_id`s of products that have never been ordered.
---solution
SELECT product_id FROM products EXCEPT SELECT product_id FROM order_items;
:::
