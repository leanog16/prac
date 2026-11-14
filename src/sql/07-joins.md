---
id: sql-joins
title: Inner joins
summary: Combining tables through keys — join conditions, aliases, multi-table joins, join-then-aggregate, and the row-multiplication effect.
minutes: 35
---
> [!project] Desk & Co, step 7: revenue by category
> Product IDs mean nothing to Maya; she thinks in categories. Revenue lives in `order_items`, categories live in `products`, and cancelled orders live in `orders`. Joins put them together.

## Why join?

Normalized databases split facts across tables. An employee row stores `dept_id = 3`; the name "Sales" lives in `departments`. A **join** pairs rows from two tables according to a condition, producing wider rows that combine both.

```sql run
SELECT e.first_name, e.last_name, d.name AS department
FROM employees e
JOIN departments d ON e.dept_id = d.dept_id;
```

- `employees e` gives the table an **alias** `e`, so we can write `e.first_name`.
- `ON e.dept_id = d.dept_id` is the **join condition**: which pairs belong together.
- `JOIN` means `INNER JOIN`: only pairs where the condition is TRUE survive.

Count the rows: 22, not 24. Maya (CEO) and Nora have a NULL `dept_id`; NULL never equals anything, so they have no partner and an inner join drops them. Outer joins (next module) keep them.

## How to think about a join

Conceptually, the database:

1. Forms every possible pair of rows (the **Cartesian product**: 24 employees × 6 departments = 144 pairs).
2. Keeps the pairs where `ON` is TRUE.
3. Continues with `WHERE`, `GROUP BY`, etc. on those combined rows.

(Real engines use indexes and hash joins rather than building all pairs, but the *result* is defined this way.)

> [!why] The mental model that never fails
> Each output row = one row from the left table glued to one matching row from the right table. If a left row has 3 matches, it appears 3 times. If it has 0 matches, an inner join drops it.

## Qualify your columns

When both tables have a column with the same name (`dept_id`), you **must** say which one: `e.dept_id`. It's good practice to qualify *every* column in a join query: readers shouldn't have to know the schema to see where `name` comes from.

## USING and NATURAL JOIN

If the key columns share a name, `USING (col)` is shorthand and produces a single merged column:

```sql run
SELECT first_name, name AS department
FROM employees JOIN departments USING (dept_id);
```

`NATURAL JOIN` joins on *all* same-named columns automatically. Avoid it: add a column called `name` to both tables someday and your join silently changes meaning.

## Joining three or more tables

Chain joins; each `ON` connects the new table to something already joined. To see which student took which course with which grade, go through the **junction table** `enrollments`:

```sql run
SELECT s.first_name, s.last_name, c.code, e.term, e.grade
FROM enrollments e
JOIN students s ON s.student_id = e.student_id
JOIN courses  c ON c.course_id  = e.course_id
WHERE c.code = 'CSC 316'
ORDER BY e.term, s.last_name;
```

Four tables, to add the instructor:

```sql run
SELECT c.code, c.title, i.name AS instructor, COUNT(*) AS enrolled
FROM courses c
JOIN instructors i ON i.instructor_id = c.instructor_id
JOIN enrollments e ON e.course_id = c.course_id
GROUP BY c.course_id
ORDER BY enrolled DESC;
```

## Join, then aggregate

Joins and GROUP BY combine naturally: join to get the labels, group to summarize.

```sql run
SELECT d.name, COUNT(*) AS headcount, MAX(e.salary) AS top_salary
FROM employees e
JOIN departments d ON d.dept_id = e.dept_id
GROUP BY d.dept_id, d.name;
```

> [!warn] Row multiplication (fan-out)
> When you join a "one" table to a "many" table, the "one" side's values repeat. Joining `orders` to `order_items` repeats each order once per line item, so `COUNT(*)` then counts *items*, not orders. Use `COUNT(DISTINCT o.order_id)`. Worse: joining two *different* many-tables to the same parent (say, items and payments) multiplies them together and inflates SUMs. Aggregate each one separately first.

```sql run
SELECT COUNT(*) AS joined_rows, COUNT(DISTINCT o.order_id) AS actual_orders
FROM orders o JOIN order_items oi ON oi.order_id = o.order_id;
```

## Join conditions vs filters

For an **inner** join, a condition in `ON` and the same condition in `WHERE` give identical results. Convention: put the *relationship* (keys) in `ON` and the *filters* in `WHERE`. For outer joins the placement changes the meaning, as you'll see next.

## Old-style comma joins

You'll see this in older code and textbooks:

```sql
SELECT e.first_name, d.name
FROM employees e, departments d
WHERE e.dept_id = d.dept_id;
```

It's equivalent to an inner join. Forget the `WHERE` and you get the full Cartesian product, which is why explicit `JOIN … ON` is preferred.

## Worked example: a three-table join, built in stages

Goal: revenue per category, **excluding cancelled orders**.

**Stage 1.** Start from the fact table and attach product details. The preview is limited to eight rows. Remove `LIMIT 8` and run it to check that the full row count matches `order_items` (85): each line has exactly one product.

```sql run
SELECT oi.order_id, p.name, p.category, oi.quantity * oi.unit_price AS line_total
FROM order_items AS oi
JOIN products AS p ON p.product_id = oi.product_id
LIMIT 8;
```

**Stage 2.** Attach the order so you can filter on its status:

```sql run
SELECT oi.order_id, o.status, p.category, oi.quantity * oi.unit_price AS line_total
FROM order_items AS oi
JOIN products AS p ON p.product_id = oi.product_id
JOIN orders   AS o ON o.order_id   = oi.order_id
WHERE o.status <> 'cancelled'
LIMIT 8;
```

**Stage 3.** Now aggregate:

```sql run
SELECT p.category, ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
FROM order_items AS oi
JOIN products AS p ON p.product_id = oi.product_id
JOIN orders   AS o ON o.order_id   = oi.order_id
WHERE o.status <> 'cancelled'
GROUP BY p.category
ORDER BY revenue DESC;
```

Building in stages lets you **check the grain at each step**. If a join multiplies rows unexpectedly (a one-to-many relationship you didn't expect), you'll see it before the totals are wrong.

> [!plain] In plain English
> A join lines up rows from two tables wherever the `ON` condition matches, like matching invoice lines to a price list by product number. An inner `JOIN` drops rows that have no partner on the other side.

## Common mistakes

> [!mistake] Fan-out double counting
> Joining `orders` to `order_items` gives one row **per line**. If you then `SUM` an order-level number (like a shipping fee on `orders`), it's added once per line. Aggregate at the right grain first, or sum the order-level value from `orders` alone.

> [!mistake] Forgetting the ON condition
> Without it (or with a wrong one) every row pairs with every row: 85 × 15 = 1,275 rows of nonsense. If a count looks huge, check your `ON`.

- Give every table a short alias and prefix every column (`p.category`), even when it's unambiguous. Future you will thank you.

:::quiz
q: `employees` has 24 rows, 2 with NULL dept_id. Every non-NULL dept_id exists in departments. How many rows does `employees JOIN departments ON e.dept_id = d.dept_id` return?
- 24
+ 22
- 6
- 144
why: Each employee with a valid dept_id matches exactly one department; NULLs match nothing and are dropped by the inner join.
:::

:::quiz
q: An order has 4 line items. After `orders JOIN order_items`, how many rows represent that order?
- 1
+ 4
- 5
- depends on the ORDER BY
why: Each order row pairs with each of its matching item rows.
:::

:::quiz
q: Why might `NATURAL JOIN` be dangerous?
- It's slower than INNER JOIN
+ It joins on every column with a matching name, which can change silently when schemas evolve
- It drops NULL rows
- It only works on primary keys
why: Explicit ON / USING documents exactly which columns relate.
:::

:::quiz
q: `FROM a, b` with no WHERE condition produces…
- an error
- only matching rows
+ every combination of rows (Cartesian product)
- the union of a and b
why: Comma-joins are cross joins until a condition filters them.
:::

:::exercise
id: jn-emp-dept
level: 1
title: Employees with department names
---
List each employee's `first_name`, `last_name`, and their department's name as `department`. Employees without a department can be left out.
---solution
SELECT e.first_name, e.last_name, d.name AS department
FROM employees e JOIN departments d ON d.dept_id = e.dept_id;
:::

:::exercise
id: jn-course-instructor
level: 1
title: Who teaches what
---
Return each course's `code`, `title`, and its instructor's `name`. Courses without an instructor may be omitted.
---solution
SELECT c.code, c.title, i.name FROM courses c JOIN instructors i ON i.instructor_id = c.instructor_id;
:::

:::exercise
id: jn-order-customer
level: 1
title: Orders with customer names
---
Return `order_id`, `order_date` and the customer's `name` for every order.
---solution
SELECT o.order_id, o.order_date, c.name FROM orders o JOIN customers c ON c.customer_id = o.customer_id;
:::

:::exercise
id: jn-raleigh-engineering
level: 2
title: Engineers in Raleigh
---
List `first_name` and `title` of employees in the **Engineering** department who live in **Raleigh**. Filter by the department *name*, not its id.
---solution
SELECT e.first_name, e.title FROM employees e
JOIN departments d ON d.dept_id = e.dept_id
WHERE d.name = 'Engineering' AND e.city = 'Raleigh';
:::

:::exercise
id: jn-transcript
level: 2
title: A student's transcript
ordered: true
---
Show the transcript of student **1003** (Noah Brown): course `code`, `title`, `term`, `grade`. Order by `code`.
---solution
SELECT c.code, c.title, e.term, e.grade
FROM enrollments e JOIN courses c ON c.course_id = e.course_id
WHERE e.student_id = 1003
ORDER BY c.code;
:::

:::exercise
id: jn-headcount-names
level: 2
title: Headcount by department name
---
For each department that has employees, return the department `name` and its headcount `n`.
---solution
SELECT d.name, COUNT(*) AS n FROM employees e JOIN departments d ON d.dept_id = e.dept_id GROUP BY d.dept_id, d.name;
:::

:::exercise
id: jn-line-items
level: 2
title: Line item details
---
For order **14**, list each line: product `name`, `quantity`, `unit_price` and `line_total` (quantity × unit_price).
---solution
SELECT p.name, oi.quantity, oi.unit_price, oi.quantity * oi.unit_price AS line_total
FROM order_items oi JOIN products p ON p.product_id = oi.product_id
WHERE oi.order_id = 14;
:::

:::exercise
id: jn-three-tables
level: 3
title: Calculus roster
---
List the `first_name`, `last_name` and `term` of every student who has enrolled in **any calculus course** (title contains `Calculus`), together with the course `code`.
---solution
SELECT s.first_name, s.last_name, e.term, c.code
FROM enrollments e
JOIN students s ON s.student_id = e.student_id
JOIN courses c ON c.course_id = e.course_id
WHERE c.title LIKE '%Calculus%';
:::

:::exercise
id: jn-customer-spend
level: 3
title: Customer lifetime spend
ordered: true
---
For each customer who has ordered, return `name` and `spent`: total of quantity × unit_price over all their **non-cancelled** orders, rounded to 2 decimals. Sort by `spent` descending.
---solution
SELECT c.name, ROUND(SUM(oi.quantity * oi.unit_price), 2) AS spent
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status <> 'cancelled'
GROUP BY c.customer_id, c.name
ORDER BY spent DESC;
:::

:::exercise
id: jn-instructor-load
level: 3
title: Teaching load
---
For each instructor who teaches at least one course, return `name`, the number of courses they teach as `courses`, and total enrollments across those courses as `students` (count enrollment rows).
---hint
Joining courses to enrollments multiplies rows. Count courses with DISTINCT.
---solution
SELECT i.name, COUNT(DISTINCT c.course_id) AS courses, COUNT(e.student_id) AS students
FROM instructors i
JOIN courses c ON c.instructor_id = i.instructor_id
JOIN enrollments e ON e.course_id = c.course_id
GROUP BY i.instructor_id, i.name;
:::

:::exercise
id: jn-category-revenue
level: 3
title: Revenue by category
ordered: true
---
Total revenue (quantity × unit_price) per product `category` across **delivered** orders only, rounded to 2 decimals, highest first. Return `category` and `revenue`.
---solution
SELECT p.category, ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
FROM order_items oi
JOIN products p ON p.product_id = oi.product_id
JOIN orders o ON o.order_id = oi.order_id
WHERE o.status = 'delivered'
GROUP BY p.category
ORDER BY revenue DESC;
:::

:::exercise
id: jn-discounted
level: 3
title: Sold below list price
---
Find line items where the `unit_price` charged was **less than** the product's current list `price`. Return `order_id`, product `name`, `price` and `unit_price`.
---solution
SELECT oi.order_id, p.name, p.price, oi.unit_price
FROM order_items oi JOIN products p ON p.product_id = oi.product_id
WHERE oi.unit_price < p.price;
:::

:::exercise
id: jn-avg-gpa-course
level: 4
title: Strong classrooms
ordered: true
---
For each course `code`, compute the average GPA (2 decimals) of the **distinct students** who ever enrolled, ignoring students with NULL GPA. Show only courses where that average is **at least 3.3**, highest average first. Return `code` and `avg_gpa`.
---hint
A student who took a course twice would be counted twice. Deduplicate (course, student) pairs first, e.g. with a subquery `SELECT DISTINCT course_id, student_id FROM enrollments`.
---solution
SELECT c.code, ROUND(AVG(s.gpa), 2) AS avg_gpa
FROM (SELECT DISTINCT course_id, student_id FROM enrollments) e
JOIN courses c ON c.course_id = e.course_id
JOIN students s ON s.student_id = e.student_id
WHERE s.gpa IS NOT NULL
GROUP BY c.course_id, c.code
HAVING AVG(s.gpa) >= 3.3
ORDER BY avg_gpa DESC;
:::

:::exercise
id: jn-same-city
level: 4
title: Neighbors
---
Pair up **customers and employees who live in the same city**. Return customer `name`, employee `first_name`, and the `city`. (Only cities that appear in both tables will produce rows.)
---hint
The join condition doesn't have to be a key. `ON c.city = e.city` is fine.
---solution
SELECT c.name, e.first_name, c.city
FROM customers c JOIN employees e ON e.city = c.city;
:::

:::exercise
id: proj-sql-07-category
level: 3
title: "Project 7: revenue by category"
ordered: true
---
Show each product `category` with its `revenue` (sum of quantity × unit price, rounded to 2 decimals) from orders that are **not cancelled**, highest revenue first.
---solution
SELECT p.category, ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue FROM order_items oi JOIN products p ON p.product_id = oi.product_id JOIN orders o ON o.order_id = oi.order_id WHERE o.status <> 'cancelled' GROUP BY p.category ORDER BY revenue DESC;
:::

:::exercise
id: proj-sql-07-order-detail
level: 2
title: "Project 7b: an order's packing slip"
ordered: true
---
For order **7**, list the customer's `name`, each product `name` as `product`, and the `quantity`, sorted by product name.
---solution
SELECT c.name, p.name AS product, oi.quantity FROM orders o JOIN customers c ON c.customer_id = o.customer_id JOIN order_items oi ON oi.order_id = o.order_id JOIN products p ON p.product_id = oi.product_id WHERE o.order_id = 7 ORDER BY p.name;
:::
