---
id: sql-window
title: Window functions
summary: Aggregates that don't collapse rows — OVER, PARTITION BY, ranking, running totals, LAG/LEAD, frames, and top-N per group.
minutes: 40
---
> [!project] Desk & Co, step 12: rankings and running totals
> Maya wants each product's rank inside its category and a running revenue total across the year. Both need numbers computed **across** rows without collapsing them: window functions.

## GROUP BY collapses; windows don't

`GROUP BY` turns many rows into one per group. A **window function** computes across a set of related rows (the *window*) but **keeps every row**, attaching the result as a new column.

```sql run
SELECT first_name, dept_id, salary,
       AVG(salary) OVER (PARTITION BY dept_id) AS dept_avg,
       salary - AVG(salary) OVER (PARTITION BY dept_id) AS diff_from_avg
FROM employees
WHERE dept_id IS NOT NULL
ORDER BY dept_id, salary DESC;
```

Each row still shows its own salary, plus its department's average. Doing that with GROUP BY needs a subquery and a join.

## Anatomy of OVER

```sql
function(...) OVER (
  PARTITION BY ...   -- split rows into independent groups (optional)
  ORDER BY ...       -- order rows within each partition (optional)
  ROWS BETWEEN ...   -- the frame: which rows around the current one (optional)
)
```

- `OVER ()` with nothing inside: the whole result is one window.
- `PARTITION BY` is like GROUP BY without collapsing.
- `ORDER BY` inside OVER defines sequence for ranking and running calculations; it's separate from the query's final ORDER BY.

Window functions are evaluated after WHERE/GROUP BY/HAVING and before the final ORDER BY/LIMIT. So **you can't use them in WHERE**. To filter on one, wrap the query in a subquery or CTE.

## Ranking functions

| Function | Ties | Example for scores 90, 85, 85, 80 |
|---|---|---|
| `ROW_NUMBER()` | arbitrary but unique | 1, 2, 3, 4 |
| `RANK()` | same rank, then gap | 1, 2, 2, 4 |
| `DENSE_RANK()` | same rank, no gap | 1, 2, 2, 3 |
| `NTILE(n)` | split into n buckets | 1, 1, 2, 2 (n = 2) |

```sql run
SELECT first_name, salary,
       ROW_NUMBER() OVER (ORDER BY salary DESC) AS rn,
       RANK()       OVER (ORDER BY salary DESC) AS rnk,
       DENSE_RANK() OVER (ORDER BY salary DESC) AS dense
FROM employees
WHERE salary BETWEEN 55000 AND 70000;
```

Leo and Ben both earn 61,000. Look at how each function numbers them, and what the *next* row gets.

## Top-N per group

The most-asked window pattern: rank within each partition, then filter in an outer query.

```sql run
WITH ranked AS (
  SELECT d.name AS dept, e.first_name, e.salary,
         ROW_NUMBER() OVER (PARTITION BY e.dept_id ORDER BY e.salary DESC) AS rn
  FROM employees e JOIN departments d ON d.dept_id = e.dept_id
)
SELECT dept, first_name, salary FROM ranked WHERE rn <= 2 ORDER BY dept, rn;
```

Use `RANK()` instead of `ROW_NUMBER()` if tied rows should all be included.

## Running totals and moving averages

With `ORDER BY` inside `OVER`, aggregate window functions become *cumulative*:

```sql run
WITH daily AS (
  SELECT o.order_date, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY o.order_date
)
SELECT order_date, ROUND(revenue, 2) AS revenue,
       ROUND(SUM(revenue) OVER (ORDER BY order_date), 2) AS running_total,
       ROUND(AVG(revenue) OVER (ORDER BY order_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS moving_avg_3
FROM daily
LIMIT 10;
```

### Frames

The **frame** says which rows around the current one the function sees:

| Frame | Meaning |
|---|---|
| `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` | start of partition through this row (running total) |
| `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` | this row and the two before (3-row moving window) |
| `ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING` | centered window of 3 |
| `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` | the whole partition |

> [!warn] The default frame surprise
> With `ORDER BY` and no explicit frame, the default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. "RANGE" treats rows with the **same ORDER BY value** as peers, so tied rows all get the same running total. Use `ROWS` when you want strictly row-by-row behavior.

## LAG and LEAD

`LAG(col, n, default)` reads a value from `n` rows **before** the current one in the window order; `LEAD` reads from rows **after**. Perfect for period-over-period changes and gaps between events.

```sql run
SELECT customer_id, order_id, order_date,
       LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS prev_order,
       CAST(JULIANDAY(order_date) - JULIANDAY(LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date)) AS INTEGER) AS days_since_prev
FROM orders
WHERE customer_id IN (1, 15)
ORDER BY customer_id, order_date;
```

## FIRST_VALUE, LAST_VALUE, percent of total

```sql run
SELECT name, category, price,
       FIRST_VALUE(name) OVER (PARTITION BY category ORDER BY price DESC) AS priciest_in_category,
       ROUND(100.0 * price / SUM(price) OVER (PARTITION BY category), 1) AS pct_of_category
FROM products
ORDER BY category, price DESC;
```

`LAST_VALUE` usually needs an explicit full frame (`ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`); with the default frame, the "last" row is the current one.

## Named windows

Repeating the same `OVER (…)` is noisy. SQLite and PostgreSQL support a `WINDOW` clause:

```sql run
SELECT first_name, salary,
       RANK() OVER w AS rnk, ROUND(PERCENT_RANK() OVER w, 2) AS pct_rank
FROM employees
WINDOW w AS (ORDER BY salary)
LIMIT 6;
```

## Worked example: rank within a group

Start from per-product revenue (a CTE), then rank inside each category:

```sql run
WITH rev AS (
  SELECT p.product_id, p.name, p.category, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM products p JOIN order_items oi ON oi.product_id = p.product_id
  GROUP BY p.product_id, p.name, p.category
)
SELECT category, name, ROUND(revenue, 2) AS revenue,
       RANK() OVER (PARTITION BY category ORDER BY revenue DESC) AS rank_in_category
FROM rev
ORDER BY category, rank_in_category;
```

Read the `OVER` clause aloud: "**partition** the rows by category (each category is its own little table), **order** each partition by revenue descending, and give each row its position".

## Worked example: a running total

```sql run
WITH monthly AS (
  SELECT strftime('%Y-%m', o.order_date) AS month, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY month
)
SELECT month, ROUND(revenue, 2) AS revenue,
       ROUND(SUM(revenue) OVER (ORDER BY month), 2) AS running_total,
       ROUND(revenue - LAG(revenue) OVER (ORDER BY month), 2) AS change
FROM monthly
ORDER BY month;
```

`SUM(...) OVER (ORDER BY month)` adds up every month **up to and including** the current one. `LAG` reaches back one row, which gives month-over-month change. The first month's change is NULL because there's no earlier row.

> [!plain] In plain English
> `GROUP BY` squashes rows into one per group. A window function keeps every row and **adds a column** computed from that row's neighbours.

## Which ranking function?

| Values | ROW_NUMBER | RANK | DENSE_RANK |
|---|---|---|---|
| 90 | 1 | 1 | 1 |
| 80 | 2 | 2 | 2 |
| 80 | 3 | 2 | 2 |
| 70 | 4 | **4** | **3** |

Use `ROW_NUMBER` for "exactly one per group" (pick a tie-breaker!), `RANK` for competition-style ranking, `DENSE_RANK` when you want no gaps.

## Common mistakes

> [!mistake] Filtering on a window function in WHERE
> `WHERE rank_in_category = 1` fails: windows are computed **after** WHERE. Wrap the query in a CTE and filter outside it.

:::quiz
q: How many rows does `SELECT dept_id, AVG(salary) OVER (PARTITION BY dept_id) FROM employees` return for 24 employees?
- one per department
+ 24
- 1
- it's an error without GROUP BY
why: Window functions never collapse rows.
:::

:::quiz
q: Scores 100, 90, 90, 70. What does DENSE_RANK() (highest first) give the 70?
- 4
+ 3
- 2
- 70
why: DENSE_RANK leaves no gaps: 1, 2, 2, 3. RANK would give 4.
:::

:::quiz
q: Why does `WHERE ROW_NUMBER() OVER (…) <= 3` fail?
- ROW_NUMBER needs PARTITION BY
+ Window functions are computed after WHERE, so WHERE can't reference them
- You must use RANK instead
- LIMIT must be used
why: Compute the window function in a subquery/CTE, then filter in the outer query.
:::

:::quiz
q: `SUM(x) OVER (ORDER BY d)` with no frame clause gives…
+ a running total, where rows with equal d get the same value
- the grand total on every row
- the value of x
- an error
why: The default frame is RANGE … CURRENT ROW, which includes peers with the same ORDER BY value.
:::

:::quiz
q: `LAG(price, 1, 0) OVER (ORDER BY day)` on the first row returns…
- NULL
+ 0
- the first row's price
- an error
why: The third argument is the default used when there is no previous row.
:::

:::exercise
id: win-rank-salary
level: 1
title: Salary ranking
---
Return every employee's `first_name`, `salary` and `rnk` = their `RANK()` by salary, highest salary = 1.
---solution
SELECT first_name, salary, RANK() OVER (ORDER BY salary DESC) AS rnk FROM employees;
:::

:::exercise
id: win-dept-avg
level: 1
title: Compare to your department
---
For employees with a department, return `first_name`, `dept_id`, `salary` and `dept_avg` (their department's average salary, rounded to whole dollars), without GROUP BY.
---solution
SELECT first_name, dept_id, salary, ROUND(AVG(salary) OVER (PARTITION BY dept_id)) AS dept_avg
FROM employees WHERE dept_id IS NOT NULL;
:::

:::exercise
id: win-row-number
level: 2
title: Number the orders
---
Number each customer's orders chronologically: return `customer_id`, `order_id`, `order_date` and `nth` (1 for their first order, 2 for the second, …).
---solution
SELECT customer_id, order_id, order_date,
       ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date) AS nth
FROM orders;
:::

:::exercise
id: win-pct-total
level: 2
title: Share of the catalog
---
For each product, return `name`, `price` and `pct` = its price as a percentage of the **sum of all prices**, rounded to 1 decimal.
---solution
SELECT name, price, ROUND(100.0 * price / SUM(price) OVER (), 1) AS pct FROM products;
:::

:::exercise
id: win-dense-gpa
level: 2
title: GPA ranks within major
---
For students with both a major and a GPA, return `first_name`, `major`, `gpa` and `pos` = their `DENSE_RANK()` within their major (highest GPA = 1).
---solution
SELECT first_name, major, gpa, DENSE_RANK() OVER (PARTITION BY major ORDER BY gpa DESC) AS pos
FROM students WHERE major IS NOT NULL AND gpa IS NOT NULL;
:::

:::exercise
id: win-top2-dept
level: 3
title: Top two earners per department
---
Return `dept_id`, `first_name`, `salary` for the **two highest-paid** employees in each department (employees with no department excluded).
---hint
ROW_NUMBER in a CTE, filter `rn <= 2` outside.
---solution
WITH r AS (
  SELECT dept_id, first_name, salary,
         ROW_NUMBER() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn
  FROM employees WHERE dept_id IS NOT NULL
)
SELECT dept_id, first_name, salary FROM r WHERE rn <= 2;
:::

:::exercise
id: win-running
level: 3
title: Cumulative hires
ordered: true
---
List employees by `hire_date` (earliest first) with `first_name`, `hire_date` and `headcount`: how many people had been hired up to and including that date.
---solution
SELECT first_name, hire_date, COUNT(*) OVER (ORDER BY hire_date) AS headcount FROM employees ORDER BY hire_date;
:::

:::exercise
id: win-lag-gap
level: 3
title: Days between orders
---
For customer **15**, list each `order_id`, `order_date` and `gap` = days since their previous order (NULL for the first), as an integer.
---solution
SELECT order_id, order_date,
       CAST(JULIANDAY(order_date) - JULIANDAY(LAG(order_date) OVER (ORDER BY order_date)) AS INTEGER) AS gap
FROM orders WHERE customer_id = 15;
:::

:::exercise
id: win-latest-per-customer
level: 3
title: Each customer's latest order
---
Return `customer_id`, `order_id` and `order_date` of every customer's **most recent** order.
---solution
WITH r AS (
  SELECT customer_id, order_id, order_date,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC) AS rn
  FROM orders
)
SELECT customer_id, order_id, order_date FROM r WHERE rn = 1;
:::

:::exercise
id: win-ntile
level: 3
title: Salary quartiles
---
Assign every employee to a salary **quartile** (1 = lowest-paid quarter, 4 = highest). Return `first_name`, `salary`, `quartile`.
---solution
SELECT first_name, salary, NTILE(4) OVER (ORDER BY salary) AS quartile FROM employees;
:::

:::exercise
id: win-month-growth
level: 4
title: Month-over-month growth
ordered: true
---
Monthly revenue for non-cancelled orders in 2025, with growth: return `month` (`2025-01`), `revenue` (2 decimals), `prev` (previous month's revenue, 2 decimals, NULL for the first) and `change_pct` = percent change from the previous month, rounded to 1 decimal. Order by month.
---hint
Aggregate per month in a CTE first, then apply LAG over the monthly rows.
---solution
WITH m AS (
  SELECT STRFTIME('%Y-%m', o.order_date) AS month, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY month
)
SELECT month, ROUND(revenue, 2) AS revenue,
       ROUND(LAG(revenue) OVER (ORDER BY month), 2) AS prev,
       ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month)) / LAG(revenue) OVER (ORDER BY month), 1) AS change_pct
FROM m ORDER BY month;
:::

:::exercise
id: win-moving-avg
level: 4
title: Three-order moving average
ordered: true
---
Using order totals (sum of quantity × unit_price per order, all statuses), return `order_id`, `total` (2 decimals) and `moving_avg` = the average of this order and the **two previous orders by order_id**, rounded to 2 decimals. Order by order_id.
---solution
WITH t AS (SELECT order_id, SUM(quantity * unit_price) AS total FROM order_items GROUP BY order_id)
SELECT order_id, ROUND(total, 2) AS total,
       ROUND(AVG(total) OVER (ORDER BY order_id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS moving_avg
FROM t ORDER BY order_id;
:::

:::exercise
id: win-gaps-islands
level: 4
title: Gaps and islands
ordered: true
---
A sorted list of IDs breaks into "islands": maximal runs of consecutive numbers like 3, 4, 5. Take the distinct `course_id`s that student **1004** has enrolled in, and return each island as `start_id`, `end_id`, ordered by `start_id`.
---hint
Classic trick: within a sorted list, `course_id - ROW_NUMBER()` is constant across a consecutive run. Group by that difference.
---solution
WITH c AS (SELECT DISTINCT course_id FROM enrollments WHERE student_id = 1004),
g AS (SELECT course_id, course_id - ROW_NUMBER() OVER (ORDER BY course_id) AS grp FROM c)
SELECT MIN(course_id) AS start_id, MAX(course_id) AS end_id FROM g GROUP BY grp ORDER BY start_id;
:::

:::exercise
id: proj-sql-12-rank
level: 3
title: "Project 12: top product per category"
ordered: true
---
For each category, return the product with the highest revenue (sum of quantity × unit price over all its order lines): columns `category`, `name`, `revenue` (rounded to 2 decimals), sorted by category. Use `ROW_NUMBER()` partitioned by category; break ties by product name.
---solution
WITH rev AS (SELECT p.name, p.category, SUM(oi.quantity * oi.unit_price) AS revenue FROM products p JOIN order_items oi ON oi.product_id = p.product_id GROUP BY p.product_id, p.name, p.category), ranked AS (SELECT category, name, revenue, ROW_NUMBER() OVER (PARTITION BY category ORDER BY revenue DESC, name) AS rn FROM rev) SELECT category, name, ROUND(revenue, 2) AS revenue FROM ranked WHERE rn = 1 ORDER BY category;
:::

:::exercise
id: proj-sql-12-running
level: 3
title: "Project 12b: running revenue"
ordered: true
---
Using monthly revenue from non-cancelled orders, return `month` (`YYYY-MM`), `revenue` and `running_total`, both rounded to 2 decimals, in month order.
---solution
WITH monthly AS (SELECT strftime('%Y-%m', o.order_date) AS month, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id WHERE o.status <> 'cancelled' GROUP BY month) SELECT month, ROUND(revenue, 2) AS revenue, ROUND(SUM(revenue) OVER (ORDER BY month), 2) AS running_total FROM monthly ORDER BY month;
:::
