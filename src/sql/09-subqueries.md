---
id: sql-subq
title: Subqueries
summary: Queries inside queries — scalar subqueries, IN and EXISTS, correlated subqueries, and derived tables in FROM.
minutes: 35
---
> [!project] Desk & Co, step 9: above-average customers
> "Who spends more than a typical customer?" needs two answers in one query: the average, and each customer's total. Subqueries let one query use another's result.

## A query is a value

Any `SELECT` in parentheses can be used inside another query. What it can stand in for depends on its shape:

| Shape | Name | Where it fits |
|---|---|---|
| 1 row × 1 column | **scalar subquery** | anywhere a single value fits (SELECT, WHERE, comparisons) |
| N rows × 1 column | **list** | `IN (…)`, `EXISTS`, `= ANY`, `> ALL` |
| N rows × M columns | **table** (derived table) | `FROM (…) AS alias`, joins |

## Scalar subqueries

"Who earns more than the average?" needs the average first. A scalar subquery computes it inline:

```sql run
SELECT first_name, salary
FROM employees
WHERE salary > (SELECT AVG(salary) FROM employees)
ORDER BY salary DESC;
```

Scalar subqueries also work in the SELECT list, for example to show each value next to a total:

```sql run
SELECT name, price,
       ROUND(100.0 * price / (SELECT SUM(price) FROM products), 1) AS pct_of_catalog
FROM products ORDER BY price DESC LIMIT 5;
```

If a "scalar" subquery returns more than one row, PostgreSQL raises an error; SQLite silently uses the first row. Make sure it really returns one value.

## IN (subquery)

```sql run
-- customers who have at least one cancelled order
SELECT name FROM customers
WHERE customer_id IN (SELECT customer_id FROM orders WHERE status = 'cancelled');
```

`IN` behaves like a semi-join: each customer appears once no matter how many cancelled orders they have, which is exactly what a plain JOIN wouldn't give you without `DISTINCT`.

## Correlated subqueries

A **correlated** subquery refers to the outer query's current row, so it's (conceptually) re-run for every outer row. "Employees who earn more than their *own department's* average":

```sql run
SELECT e.first_name, e.dept_id, e.salary
FROM employees e
WHERE e.salary > (SELECT AVG(e2.salary)
                  FROM employees e2
                  WHERE e2.dept_id = e.dept_id);
```

The inner `e.dept_id` refers to the outer row. Read it as: "for this employee `e`, compute the average of their department, then compare."

## EXISTS and NOT EXISTS

`EXISTS (subquery)` is true if the subquery returns at least one row. The select list doesn't matter (`SELECT 1` is conventional). It's almost always correlated.

```sql run
-- instructors who teach at least one course with enrollments
SELECT i.name FROM instructors i
WHERE EXISTS (SELECT 1 FROM courses c
              JOIN enrollments e ON e.course_id = c.course_id
              WHERE c.instructor_id = i.instructor_id);
```

`NOT EXISTS` is the robust anti-join. Unlike `NOT IN`, it's immune to NULLs:

```sql run
-- employees who manage nobody (works despite the CEO's NULL manager_id)
SELECT first_name FROM employees m
WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.manager_id = m.emp_id);
```

> [!tip] Choosing between the anti-join styles
> `LEFT JOIN … WHERE b.key IS NULL` and `NOT EXISTS` are equivalent and both safe. `NOT IN` is only safe when the subquery column can't be NULL. When in doubt, use `NOT EXISTS`.

## ANY / ALL

Standard SQL has `x > ALL (subquery)` (greater than every value) and `x = ANY (subquery)` (same as IN). **SQLite doesn't support ANY/ALL**, but you can always rewrite them: `> ALL (…)` becomes `> (SELECT MAX(…))`, and `> ANY (…)` becomes `> (SELECT MIN(…))`. (Careful: the MAX rewrite differs when the subquery is empty or has NULLs.)

## Derived tables (subqueries in FROM)

A subquery in `FROM` acts like a temporary table. It must have an alias. This is how you aggregate *twice* (an aggregate of aggregates) or filter on a computed column:

```sql run
-- average number of items per order
SELECT ROUND(AVG(n_items), 2) AS avg_items_per_order
FROM (SELECT order_id, SUM(quantity) AS n_items
      FROM order_items GROUP BY order_id) AS per_order;
```

```sql run
-- each department's share of total payroll
SELECT d.name, t.payroll,
       ROUND(100.0 * t.payroll / (SELECT SUM(salary) FROM employees), 1) AS pct
FROM (SELECT dept_id, SUM(salary) AS payroll FROM employees GROUP BY dept_id) t
JOIN departments d ON d.dept_id = t.dept_id
ORDER BY pct DESC;
```

The next module introduces **CTEs** (`WITH`), which let you name these derived tables up front and make complex queries far more readable.

## Subquery or join?

Many questions can be answered either way. Rules of thumb:

- Need columns from the other table in the output? **Join.**
- Only testing whether related rows exist? **EXISTS / IN** (no duplicate rows to clean up).
- Comparing against an aggregate (average, max)? **Scalar subquery**, or a window function.

## Worked example: inside-out

Write the inner question first, run it alone, then wrap it.

**Inner: what does each customer spend?**

```sql run
SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS spent
FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status <> 'cancelled'
GROUP BY o.customer_id;
```

**Middle: the average of those totals.** Use the inner query as a *derived table*:

```sql run
SELECT ROUND(AVG(spent), 2) AS avg_spent
FROM (
  SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS spent
  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY o.customer_id
) AS totals;
```

**Outer: customers above it.** The repetition is getting painful, which is exactly what CTEs fix two lessons from now. For now, it works:

```sql run
SELECT customer_id, ROUND(spent, 2) AS spent
FROM (
  SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS spent
  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY o.customer_id
) AS t
WHERE spent > (
  SELECT AVG(spent) FROM (
    SELECT SUM(oi.quantity * oi.unit_price) AS spent
    FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status <> 'cancelled'
    GROUP BY o.customer_id
  )
)
ORDER BY spent DESC;
```

> [!plain] In plain English
> A subquery is a query in parentheses used where a value or a table is expected. A **scalar** subquery returns one value; an `IN` subquery returns a list; a subquery in `FROM` returns a whole table you can query again.

## Correlated subqueries, step by step

A **correlated** subquery refers to the outer row, so it conceptually runs once per row:

```sql run
SELECT p.name, p.price
FROM products p
WHERE p.price > (SELECT AVG(p2.price) FROM products p2 WHERE p2.category = p.category);
```

Read it as: "for this product, compute the average price **of its own category**, and keep the product if it's above that".

## Common mistakes

> [!mistake] A "scalar" subquery that returns several rows
> `WHERE price = (SELECT price FROM products WHERE category = 'Home')` is an error in most databases (SQLite quietly uses the first row, which is worse). Use `IN`, or make sure the subquery is aggregated.

:::quiz
q: A subquery used as `WHERE salary > (SELECT …)` must return…
+ exactly one value (one row, one column)
- one column with any number of rows
- any table
- at least one row with a column named salary
why: A comparison operator needs a single value: a scalar subquery.
:::

:::quiz
q: What makes a subquery *correlated*?
- It uses GROUP BY
- It appears in the FROM clause
+ It references a column of the outer query's current row
- It returns more than one row
why: Correlation ties the inner query to each outer row, e.g. `WHERE e2.dept_id = e.dept_id`.
:::

:::quiz
q: Which is NULL-safe for "rows of A with no match in B"?
- `WHERE a.id NOT IN (SELECT b.a_id FROM b)`
+ `WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id)`
- `WHERE a.id <> ALL (SELECT b.a_id FROM b)`
- `WHERE a.id != (SELECT b.a_id FROM b)`
why: NOT IN and <> ALL return nothing if B contains a NULL a_id. NOT EXISTS only asks whether a matching row exists.
:::

:::quiz
q: In `EXISTS (SELECT name FROM t WHERE …)`, what difference does `name` make versus `SELECT 1`?
- name must be non-NULL for EXISTS to be true
+ none; EXISTS only checks whether any row is returned
- SELECT 1 is invalid inside EXISTS
- it changes the row count of the outer query
why: EXISTS ignores the select list entirely.
:::

:::quiz
q: SQLite lacks `> ALL (subquery)`. Which rewrite is equivalent when the subquery returns non-empty, non-NULL values?
+ `> (SELECT MAX(…))`
- `> (SELECT MIN(…))`
- `IN (SELECT …)`
- `> (SELECT AVG(…))`
why: Being greater than all values means being greater than the largest one.
:::

:::exercise
id: sq-above-avg-price
level: 1
title: Pricier than average
---
List `name` and `price` of products priced above the average product price.
---solution
SELECT name, price FROM products WHERE price > (SELECT AVG(price) FROM products);
:::

:::exercise
id: sq-max-gpa
level: 1
title: Top of the class
---
Return the `first_name` and `last_name` of the student(s) with the highest GPA, using a subquery (not ORDER BY/LIMIT).
---solution
SELECT first_name, last_name FROM students WHERE gpa = (SELECT MAX(gpa) FROM students);
:::

:::exercise
id: sq-in-delivered
level: 2
title: Happy customers
---
Return the `name` of customers who have at least one **delivered** order, each name once. Use `IN` with a subquery.
---solution
SELECT name FROM customers WHERE customer_id IN (SELECT customer_id FROM orders WHERE status = 'delivered');
:::

:::exercise
id: sq-latest-hire
level: 2
title: Newest employee
---
Return `first_name`, `last_name` and `hire_date` of the most recently hired employee, using a scalar subquery.
---solution
SELECT first_name, last_name, hire_date FROM employees WHERE hire_date = (SELECT MAX(hire_date) FROM employees);
:::

:::exercise
id: sq-took-csc316
level: 2
title: Took Data Structures
---
List `first_name` and `last_name` of students who have enrolled in the course with code `CSC 316`. Use subqueries, no joins.
---hint
Nest two: course_id from courses, then student_id from enrollments.
---solution
SELECT first_name, last_name FROM students
WHERE student_id IN (SELECT student_id FROM enrollments
                     WHERE course_id = (SELECT course_id FROM courses WHERE code = 'CSC 316'));
:::

:::exercise
id: sq-not-exists-orders
level: 2
title: Never ordered (NOT EXISTS)
---
Return the `name` of every customer with no orders, using `NOT EXISTS`.
---solution
SELECT c.name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
:::

:::exercise
id: sq-dept-avg
level: 3
title: Above their department average
---
Return `first_name`, `dept_id` and `salary` of employees earning more than the average salary **of their own department**.
---solution
SELECT e.first_name, e.dept_id, e.salary FROM employees e
WHERE e.salary > (SELECT AVG(e2.salary) FROM employees e2 WHERE e2.dept_id = e.dept_id);
:::

:::exercise
id: sq-order-count-col
level: 3
title: Orders per customer, inline
---
For every customer, return `name` and `orders`: the number of orders they've placed, computed with a correlated subquery in the SELECT list.
---solution
SELECT c.name, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.customer_id) AS orders FROM customers c;
:::

:::exercise
id: sq-derived-avg
level: 3
title: Average department payroll
---
Return a single value `avg_payroll`: the average, across departments that have employees, of each department's **total** salary. Round to whole dollars. (Employees without a department don't count.)
---hint
Aggregate per department in a derived table, then aggregate that.
---solution
SELECT ROUND(AVG(payroll)) AS avg_payroll
FROM (SELECT dept_id, SUM(salary) AS payroll FROM employees WHERE dept_id IS NOT NULL GROUP BY dept_id) t;
:::

:::exercise
id: sq-max-per-category
level: 3
title: Priciest in each category
---
Return `category`, `name` and `price` of the most expensive product **in each category**.
---hint
Correlated subquery: `price = (SELECT MAX(price) FROM products p2 WHERE p2.category = p.category)`.
---solution
SELECT p.category, p.name, p.price FROM products p
WHERE p.price = (SELECT MAX(p2.price) FROM products p2 WHERE p2.category = p.category);
:::

:::exercise
id: sq-all-courses-dept
level: 4
title: Big spenders vs the average order
---
Find orders whose total (sum of quantity × unit_price) is **greater than the average order total**. Return `order_id` and `total` rounded to 2 decimals.
---hint
Compute per-order totals once in a derived table; compare each to the AVG over that same derived table.
---solution
SELECT order_id, ROUND(total, 2) AS total
FROM (SELECT order_id, SUM(quantity * unit_price) AS total FROM order_items GROUP BY order_id) t
WHERE total > (SELECT AVG(total) FROM (SELECT SUM(quantity * unit_price) AS total FROM order_items GROUP BY order_id));
:::

:::exercise
id: sq-every-term
level: 4
title: Enrolled every term
---
Which students have enrollments in **every** term that appears in the `enrollments` table? Return `student_id`.
---hint
Count the distinct terms per student and compare with the total number of distinct terms.
---solution
SELECT student_id FROM enrollments
GROUP BY student_id
HAVING COUNT(DISTINCT term) = (SELECT COUNT(DISTINCT term) FROM enrollments);
:::

:::exercise
id: sq-relational-division
level: 4
title: Took every math course
---
Relational division, the classic hard one: find students who have taken **every course in the `MA` department**. Return `student_id`, `first_name`.
---hint
Double negation: students for whom there does NOT EXIST an MA course that they have NOT taken.
---hint
Or count: students whose number of distinct MA courses equals the total number of MA courses.
---solution
SELECT s.student_id, s.first_name FROM students s
WHERE NOT EXISTS (
  SELECT 1 FROM courses c
  WHERE c.dept = 'MA'
    AND NOT EXISTS (SELECT 1 FROM enrollments e
                    WHERE e.course_id = c.course_id AND e.student_id = s.student_id)
);
---explain
The count-based alternative: `SELECT e.student_id FROM enrollments e JOIN courses c USING (course_id) WHERE c.dept = 'MA' GROUP BY e.student_id HAVING COUNT(DISTINCT c.course_id) = (SELECT COUNT(*) FROM courses WHERE dept = 'MA')`. Both are worth knowing.
:::

:::exercise
id: proj-sql-09-above-avg-price
level: 2
title: "Project 9: pricier than the category average"
---
List each product's `name`, `category` and `price` where the price is **above the average price of its own category**.
---solution
SELECT p.name, p.category, p.price FROM products p WHERE p.price > (SELECT AVG(p2.price) FROM products p2 WHERE p2.category = p.category);
:::

:::exercise
id: proj-sql-09-big-spenders
level: 3
title: "Project 9b: above-average spenders"
---
Show `customer_id` and `spent` (rounded to 2 decimals) for customers whose total spend on **non-cancelled** orders is greater than the average total spend per customer.
---solution
SELECT customer_id, ROUND(spent, 2) AS spent FROM (SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS spent FROM orders o JOIN order_items oi ON oi.order_id = o.order_id WHERE o.status <> 'cancelled' GROUP BY o.customer_id) t WHERE spent > (SELECT AVG(spent) FROM (SELECT SUM(oi.quantity * oi.unit_price) AS spent FROM orders o JOIN order_items oi ON oi.order_id = o.order_id WHERE o.status <> 'cancelled' GROUP BY o.customer_id));
:::
