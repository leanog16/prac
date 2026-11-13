---
id: sql-agg
title: Aggregation & GROUP BY
summary: COUNT, SUM, AVG, MIN, MAX; grouping rows; HAVING vs WHERE; the "every selected column must be grouped" rule; conditional aggregation.
minutes: 35
---
## Aggregate functions collapse rows

An **aggregate function** computes one value from many rows.

| Function | Returns | NULLs |
|---|---|---|
| `COUNT(*)` | number of rows | counted |
| `COUNT(col)` | number of non-NULL values | skipped |
| `COUNT(DISTINCT col)` | number of different non-NULL values | skipped |
| `SUM(col)` | total | skipped |
| `AVG(col)` | mean | skipped |
| `MIN(col)` / `MAX(col)` | smallest / largest | skipped |
| `GROUP_CONCAT(col, sep)` | values joined into one string (SQLite; `STRING_AGG` in Postgres) | skipped |

Without `GROUP BY`, the whole table is one group, so you get one row:

```sql run
SELECT COUNT(*) AS n, MIN(salary) AS lowest, MAX(salary) AS highest,
       ROUND(AVG(salary)) AS average, SUM(salary) AS payroll
FROM employees;
```

## GROUP BY: one output row per group

`GROUP BY col` partitions rows into groups that share a value of `col`, then aggregates each group separately.

```sql run
SELECT dept_id, COUNT(*) AS headcount, ROUND(AVG(salary)) AS avg_salary
FROM employees
GROUP BY dept_id;
```

Picture it as: sort the rows into buckets by `dept_id`; each bucket becomes one output row. NULL `dept_id`s form their own bucket.

You can group by several columns (one row per *combination*) and by expressions:

```sql run
SELECT STRFTIME('%Y', order_date) AS year, status, COUNT(*) AS orders
FROM orders
GROUP BY year, status
ORDER BY year, status;
```

## The golden rule

After grouping, each output row represents a *group*, so every column in `SELECT` must be either:

1. listed in `GROUP BY`, or
2. inside an aggregate function.

```sql
-- Wrong in standard SQL: which first_name should a department's row show?
SELECT dept_id, first_name, COUNT(*) FROM employees GROUP BY dept_id;
```

PostgreSQL, SQL Server and Oracle reject that query. **SQLite and old MySQL accept it and pick an arbitrary row's value**, which is how silent bugs are born. On an exam, treat it as an error.

> [!tip] SQLite's one useful exception
> In SQLite only, when a query has a single `MAX()` or `MIN()`, the bare columns come from the row that had the max/min. Handy, but non-portable: don't rely on it in answers meant for other databases.

## WHERE vs HAVING

- `WHERE` filters **rows**, before grouping. It can't see aggregates.
- `HAVING` filters **groups**, after aggregation. It's where aggregate conditions go.

```sql run
-- departments whose average salary is above 100k, counting only people hired before 2022
SELECT dept_id, COUNT(*) AS n, ROUND(AVG(salary)) AS avg_salary
FROM employees
WHERE hire_date < '2022-01-01'
GROUP BY dept_id
HAVING AVG(salary) > 100000;
```

> [!exam] Order of evaluation, again
> FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT. "Filter on an aggregate" means HAVING. "Filter before counting" means WHERE. Putting a non-aggregate condition in HAVING works but is slower and unidiomatic.

## COUNT(DISTINCT …)

```sql run
SELECT COUNT(*) AS enrollments,
       COUNT(DISTINCT student_id) AS students,
       COUNT(DISTINCT course_id) AS courses
FROM enrollments;
```

## Conditional aggregation

Put a `CASE` (or a boolean) *inside* the aggregate to count or sum only some rows. This pivots data into columns:

```sql run
SELECT term,
       COUNT(*) AS enrollments,
       SUM(CASE WHEN grade LIKE 'A%' THEN 1 ELSE 0 END) AS a_grades,
       SUM(grade IS NULL) AS in_progress
FROM enrollments
GROUP BY term;
```

`SUM(grade IS NULL)` works because in SQLite a comparison yields 1 or 0. The portable spelling is `SUM(CASE WHEN … THEN 1 ELSE 0 END)` or `COUNT(CASE WHEN … THEN 1 END)` (COUNT skips the NULLs that the missing ELSE produces).

## GROUP_CONCAT

```sql run
SELECT dept_id, GROUP_CONCAT(first_name, ', ') AS people
FROM employees
GROUP BY dept_id;
```

:::quiz
q: Which clause can filter on `COUNT(*) > 5`?
- WHERE
+ HAVING
- GROUP BY
- ON
why: WHERE runs before aggregation, so it can't see COUNT. HAVING filters groups.
:::

:::quiz
q: `SELECT dept_id, last_name, COUNT(*) FROM employees GROUP BY dept_id` is…
- valid everywhere
+ invalid in standard SQL because last_name is neither grouped nor aggregated
- valid only with ORDER BY
- invalid because COUNT needs a column
why: Each group has many last names; the database can't know which to show. SQLite quietly picks one, which is a bug magnet.
:::

:::quiz
q: A column has values 4, NULL, 8. What is `AVG(col)`?
- 4
+ 6
- NULL
- 12
why: AVG ignores NULLs: (4 + 8) / 2 = 6.
:::

:::quiz
q: `COUNT(CASE WHEN status = 'shipped' THEN 1 END)` counts…
+ shipped rows only
- all rows
- non-shipped rows
- NULL rows
why: Rows that aren't shipped produce NULL (no ELSE), and COUNT skips NULLs.
:::

:::quiz
q: You need "departments with more than 3 employees hired after 2018". Which is right?
- `WHERE COUNT(*) > 3 AND hire_date > '2018-12-31'`
+ `WHERE hire_date > '2018-12-31' GROUP BY dept_id HAVING COUNT(*) > 3`
- `GROUP BY dept_id HAVING COUNT(*) > 3 WHERE hire_date > '2018-12-31'`
- `HAVING hire_date > '2018-12-31' AND COUNT(*) > 3` without GROUP BY
why: Row filter in WHERE (before grouping), aggregate filter in HAVING (after). Clause order is fixed: WHERE before GROUP BY before HAVING.
:::

:::exercise
id: agg-count-students
level: 1
title: How many students?
---
Return the total number of students as a single value.
---solution
SELECT COUNT(*) FROM students;
:::

:::exercise
id: agg-price-stats
level: 1
title: Price statistics
---
In one row, return the `cheapest` price, the `priciest` price, and the `avg_price` rounded to 2 decimals across all products.
---solution
SELECT MIN(price) AS cheapest, MAX(price) AS priciest, ROUND(AVG(price), 2) AS avg_price FROM products;
:::

:::exercise
id: agg-per-major
level: 1
title: Students per major
---
Return each `major` and the number of students in it as `n` (NULL majors form their own group; that's fine).
---solution
SELECT major, COUNT(*) AS n FROM students GROUP BY major;
:::

:::exercise
id: agg-category-stock
level: 2
title: Stock by category
---
For each product `category`, return the total units in `stock` (as `units`) and the number of products (as `products`).
---solution
SELECT category, SUM(stock) AS units, COUNT(*) AS products FROM products GROUP BY category;
:::

:::exercise
id: agg-status-counts
level: 2
title: Orders by status
ordered: true
---
Count orders by `status`, most common status first; break ties alphabetically by status. Return `status` and `n`.
---solution
SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY n DESC, status;
:::

:::exercise
id: agg-having-cities
level: 2
title: Hub cities
---
Which cities have **3 or more** customers? Return `city` and `customers`.
---hint
Filter on an aggregate → HAVING.
---solution
SELECT city, COUNT(*) AS customers FROM customers GROUP BY city HAVING COUNT(*) >= 3;
:::

:::exercise
id: agg-avg-score-course
level: 2
title: Course averages
---
For each `course_id` in `enrollments`, return the average `score` (rounded to 1 decimal) as `avg_score`, considering only graded enrollments.
---hint
AVG already ignores NULL scores, but be explicit if you like.
---solution
SELECT course_id, ROUND(AVG(score), 1) AS avg_score FROM enrollments WHERE score IS NOT NULL GROUP BY course_id;
:::

:::exercise
id: agg-hires-per-year
level: 2
title: Hiring by year
ordered: true
---
Return each hire year (as text, e.g. `2019`) as `year` and how many employees were hired that year as `hires`, oldest year first.
---solution
SELECT STRFTIME('%Y', hire_date) AS year, COUNT(*) AS hires FROM employees GROUP BY year ORDER BY year;
:::

:::exercise
id: agg-where-having
level: 3
title: Well-paid departments
---
Consider only employees earning **at least 60,000**. Among those, which `dept_id`s have an **average** salary above 100,000? Return `dept_id` and `avg_salary` rounded to whole dollars. Ignore employees without a department.
---solution
SELECT dept_id, ROUND(AVG(salary)) AS avg_salary
FROM employees
WHERE salary >= 60000 AND dept_id IS NOT NULL
GROUP BY dept_id
HAVING AVG(salary) > 100000;
:::

:::exercise
id: agg-order-totals
level: 3
title: Order totals
---
Using `order_items`, compute each order's total (quantity × unit_price), rounded to 2 decimals. Return `order_id` and `total` for orders whose total exceeds **500**.
---solution
SELECT order_id, ROUND(SUM(quantity * unit_price), 2) AS total
FROM order_items
GROUP BY order_id
HAVING SUM(quantity * unit_price) > 500;
:::

:::exercise
id: agg-conditional
level: 3
title: Pivot statuses into columns
---
Return a single row with one column per status, `pending`, `shipped`, `delivered`, `cancelled`, each holding the number of orders with that status.
---hint
`SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending`, and so on.
---solution
SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) AS shipped,
       SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
FROM orders;
:::

:::exercise
id: agg-distinct-courses
level: 3
title: Course load
---
For each student in `enrollments`, return `student_id`, the number of **distinct courses** they've taken as `courses`, and how many of those enrollments are **in progress** (no grade) as `in_progress`. Only include students with at least 4 distinct courses.
---solution
SELECT student_id, COUNT(DISTINCT course_id) AS courses, SUM(CASE WHEN grade IS NULL THEN 1 ELSE 0 END) AS in_progress
FROM enrollments
GROUP BY student_id
HAVING COUNT(DISTINCT course_id) >= 4;
:::

:::exercise
id: agg-group-concat
level: 3
title: Who works where?
---
For each `city` of employees (skip NULL cities), return `city`, `n` (number of employees), and `names`: their first names joined with `, ` **in alphabetical order**.
---hint
Sort the rows in a subquery first, then GROUP_CONCAT, or use SQLite 3.44's `GROUP_CONCAT(x, ', ' ORDER BY x)`.
---solution
SELECT city, COUNT(*) AS n, GROUP_CONCAT(first_name, ', ' ORDER BY first_name) AS names
FROM employees WHERE city IS NOT NULL GROUP BY city;
:::

:::exercise
id: agg-monthly-revenue
level: 4
title: Monthly revenue report
ordered: true
---
Produce a monthly report for 2025 from `orders` and `order_items`. Exclude **cancelled** orders. Return `month` (formatted `2025-01`), `orders` (distinct orders that month) and `revenue` (sum of quantity × unit_price, 2 decimals), in month order.
---hint
You'll need both tables. `FROM orders o JOIN order_items oi ON oi.order_id = o.order_id` (joins are next module, but try it).
---hint
Count orders with `COUNT(DISTINCT o.order_id)`, since joining repeats each order once per item.
---solution
SELECT STRFTIME('%Y-%m', o.order_date) AS month,
       COUNT(DISTINCT o.order_id) AS orders,
       ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status <> 'cancelled'
GROUP BY month
ORDER BY month;
:::

:::exercise
id: agg-grade-dist
level: 4
title: Letter-grade distribution
ordered: true
---
Group final grades by their **letter only** (so `A` and `A-` both count as `A`, `B+`/`B`/`B-` count as `B`, and so on). Ignore in-progress enrollments. Return `letter` and `n`, ordered by letter.
---solution
SELECT SUBSTR(grade, 1, 1) AS letter, COUNT(*) AS n
FROM enrollments
WHERE grade IS NOT NULL
GROUP BY letter
ORDER BY letter;
:::
