---
id: sql-cte
title: CTEs & recursive queries
summary: Naming intermediate results with WITH, chaining steps into readable pipelines, and walking hierarchies and sequences with recursive CTEs.
minutes: 30
---
> [!project] Desk & Co, step 11: monthly revenue, readably
> Remember the triple-nested subquery from step 9? CTEs turn it into a sequence of named steps. You'll also build Maya's monthly revenue table, the backbone of the final report.

## WITH: name your subqueries

A **Common Table Expression** defines a named, temporary result at the top of a query. It reads top-to-bottom like a recipe instead of inside-out like nested subqueries.

```sql run
WITH order_totals AS (
  SELECT order_id, SUM(quantity * unit_price) AS total
  FROM order_items
  GROUP BY order_id
)
SELECT o.order_id, o.status, ROUND(t.total, 2) AS total
FROM orders o
JOIN order_totals t ON t.order_id = o.order_id
WHERE t.total > 400
ORDER BY t.total DESC;
```

The CTE exists only for that one statement.

## Chaining several CTEs

Separate CTEs with commas. Later ones can reference earlier ones, which lets you build an analysis in steps:

```sql run
WITH order_totals AS (
  SELECT order_id, SUM(quantity * unit_price) AS total
  FROM order_items GROUP BY order_id
),
customer_totals AS (
  SELECT o.customer_id, COUNT(*) AS orders, SUM(t.total) AS spent
  FROM orders o JOIN order_totals t ON t.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY o.customer_id
),
average AS (
  SELECT AVG(spent) AS avg_spent FROM customer_totals
)
SELECT c.name, ct.orders, ROUND(ct.spent, 2) AS spent
FROM customer_totals ct
JOIN customers c ON c.customer_id = ct.customer_id
CROSS JOIN average a
WHERE ct.spent > a.avg_spent
ORDER BY ct.spent DESC;
```

> [!tip] Debugging tip
> To check an intermediate step, temporarily change the final SELECT to `SELECT * FROM customer_totals`. CTEs make big queries testable piece by piece.

## Recursive CTEs

`WITH RECURSIVE` lets a CTE refer to *itself*. It has two parts joined by `UNION ALL`:

1. the **anchor** member: the starting rows;
2. the **recursive** member: computes new rows from the rows produced in the previous step.

It repeats until a step produces no new rows. The simplest example generates numbers:

```sql run
WITH RECURSIVE nums(n) AS (
  SELECT 1             -- anchor
  UNION ALL
  SELECT n + 1 FROM nums WHERE n < 10   -- recursive step + stop condition
)
SELECT n FROM nums;
```

> [!warn] Always have a stop condition
> Without `WHERE n < 10` this would run forever (SQLite eventually stops you; other databases have recursion limits). The stop condition belongs in the recursive member.

### Walking a hierarchy

The killer application: trees stored as parent pointers. Here's the whole reporting chain under the CEO, with depth:

```sql run
WITH RECURSIVE org(emp_id, name, depth, path) AS (
  SELECT emp_id, first_name, 0, first_name
  FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.emp_id, e.first_name, o.depth + 1, o.path || ' > ' || e.first_name
  FROM employees e
  JOIN org o ON e.manager_id = o.emp_id
)
SELECT depth, path FROM org ORDER BY path;
```

Walking *upward* (all of one person's managers) flips the join: start from the person and follow `manager_id`:

```sql run
WITH RECURSIVE up(emp_id, name, manager_id) AS (
  SELECT emp_id, first_name, manager_id FROM employees WHERE first_name = 'Mia'
  UNION ALL
  SELECT e.emp_id, e.first_name, e.manager_id
  FROM employees e JOIN up ON e.emp_id = up.manager_id
)
SELECT name FROM up;
```

### Filling gaps with a calendar

Generate every month, then LEFT JOIN facts to show months with zero sales:

```sql run
WITH RECURSIVE months(m) AS (
  SELECT '2025-01-01'
  UNION ALL
  SELECT DATE(m, '+1 month') FROM months WHERE m < '2025-12-01'
)
SELECT STRFTIME('%Y-%m', m) AS month, COUNT(o.order_id) AS orders
FROM months
LEFT JOIN orders o ON STRFTIME('%Y-%m', o.order_date) = STRFTIME('%Y-%m', m)
GROUP BY m;
```

## Worked example: refactor the nested query

The "above-average spenders" query rewritten as named steps:

```sql run
WITH spend AS (
  SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS spent
  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY o.customer_id
),
avg_spend AS (
  SELECT AVG(spent) AS avg_spent FROM spend
)
SELECT c.name, ROUND(s.spent, 2) AS spent
FROM spend s
JOIN customers c ON c.customer_id = s.customer_id
CROSS JOIN avg_spend a
WHERE s.spent > a.avg_spent
ORDER BY s.spent DESC;
```

Each CTE is a small, testable query with a name that explains its purpose. To debug, temporarily change the final `SELECT` to `SELECT * FROM spend` and look at the intermediate result.

> [!plain] In plain English
> `WITH name AS (query)` creates a temporary, named result that only exists while this one statement runs. Later CTEs and the final query can use it like a table.

## A practical recursive CTE: filling gaps in a calendar

Reports should show months with **zero** sales, not skip them. Generate every month in a range, then LEFT JOIN the data onto it:

```sql run
WITH RECURSIVE months(m) AS (
  SELECT '2025-01-01'
  UNION ALL
  SELECT date(m, '+1 month') FROM months WHERE m < '2025-12-01'
)
SELECT strftime('%Y-%m', m) AS month FROM months;
```

## Common mistakes

> [!mistake] Recursion without a stop condition
> A recursive CTE needs a `WHERE` in the recursive part that eventually returns no rows, or it runs until the database gives up.

- CTEs improve readability; they don't automatically make queries faster. Some databases inline them, others materialize them.

:::quiz
q: In `WITH a AS (…), b AS (…) SELECT …`, can `b` reference `a`?
+ Yes, later CTEs can reference earlier ones
- No, CTEs are independent
- Only if b is recursive
- Only with a JOIN keyword
why: CTEs are defined in order; each can use the ones before it.
:::

:::quiz
q: A recursive CTE consists of…
- two SELECTs joined by INTERSECT
+ an anchor SELECT and a recursive SELECT joined by UNION ALL (or UNION)
- a SELECT that calls itself in its WHERE clause only
- a stored procedure
why: The anchor seeds rows; the recursive member derives new rows from the previous iteration.
:::

:::quiz
q: What stops a recursive CTE?
- The ORDER BY clause
- The anchor member returning no rows
+ An iteration of the recursive member producing no new rows
- LIMIT in the anchor
why: Recursion ends when the recursive step adds nothing, typically because a WHERE condition stops matching.
:::

:::quiz
q: How long does a CTE's result exist?
+ Only for the single statement it's attached to
- Until the session ends
- Until you DROP it
- Forever, like a view
why: A CTE is scoped to one statement. For something reusable, create a VIEW.
:::

:::exercise
id: cte-basic
level: 1
title: Rewrite with WITH
---
Using a CTE named `expensive` containing products priced over 100, return the `name` and `price` of expensive products that are **in stock**.
---solution
WITH expensive AS (SELECT * FROM products WHERE price > 100)
SELECT name, price FROM expensive WHERE stock > 0;
:::

:::exercise
id: cte-numbers
level: 1
title: Count to twenty
---
Use a recursive CTE to return the numbers 1 through 20 in a column `n`.
---solution
WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < 20)
SELECT n FROM nums;
:::

:::exercise
id: cte-evens
level: 2
title: Even squares
---
Use a recursive CTE to produce `n` and `square` (n × n) for every **even** n from 2 to 20.
---solution
WITH RECURSIVE nums(n) AS (SELECT 2 UNION ALL SELECT n + 2 FROM nums WHERE n < 20)
SELECT n, n * n AS square FROM nums;
:::

:::exercise
id: cte-dept-stats
level: 2
title: Departments above the company average
---
With a CTE `dept_avg(dept_id, avg_salary)`, return department `name` and `avg_salary` (rounded) for departments whose average salary exceeds the **overall** company average.
---solution
WITH dept_avg AS (
  SELECT dept_id, AVG(salary) AS avg_salary FROM employees WHERE dept_id IS NOT NULL GROUP BY dept_id
)
SELECT d.name, ROUND(a.avg_salary) AS avg_salary
FROM dept_avg a JOIN departments d ON d.dept_id = a.dept_id
WHERE a.avg_salary > (SELECT AVG(salary) FROM employees);
:::

:::exercise
id: cte-chain
level: 3
title: Best-selling product per category
---
Using CTEs: first compute units sold per product (`SUM(quantity)`), then find the maximum per category, then return `category`, product `name` and `units` for the top seller(s) in each category.
---solution
WITH sold AS (
  SELECT p.product_id, p.name, p.category, SUM(oi.quantity) AS units
  FROM products p JOIN order_items oi ON oi.product_id = p.product_id
  GROUP BY p.product_id, p.name, p.category
),
best AS (SELECT category, MAX(units) AS top FROM sold GROUP BY category)
SELECT s.category, s.name, s.units
FROM sold s JOIN best b ON b.category = s.category AND b.top = s.units;
:::

:::exercise
id: cte-org-depth
level: 3
title: Org chart depth
---
Use a recursive CTE starting from the CEO (`manager_id IS NULL`) to return every employee's `first_name` and `depth` (CEO = 0, direct reports = 1, …).
---solution
WITH RECURSIVE org(emp_id, first_name, depth) AS (
  SELECT emp_id, first_name, 0 FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.emp_id, e.first_name, o.depth + 1 FROM employees e JOIN org o ON e.manager_id = o.emp_id
)
SELECT first_name, depth FROM org;
:::

:::exercise
id: cte-under-owen
level: 3
title: Owen's whole organization
---
List the `first_name` of everyone who reports to **Owen** (emp_id 2), directly or indirectly. Don't include Owen.
---solution
WITH RECURSIVE sub(emp_id, first_name) AS (
  SELECT emp_id, first_name FROM employees WHERE manager_id = 2
  UNION ALL
  SELECT e.emp_id, e.first_name FROM employees e JOIN sub s ON e.manager_id = s.emp_id
)
SELECT first_name FROM sub;
:::

:::exercise
id: cte-chain-up
level: 3
title: Chain of command
ordered: true
---
Starting at **Luis** (emp_id 8), list his chain of command upward: `first_name` and `level` where Luis is level 0, his manager 1, and so on up to the CEO. Order by `level`.
---solution
WITH RECURSIVE up(emp_id, first_name, manager_id, level) AS (
  SELECT emp_id, first_name, manager_id, 0 FROM employees WHERE emp_id = 8
  UNION ALL
  SELECT e.emp_id, e.first_name, e.manager_id, up.level + 1 FROM employees e JOIN up ON e.emp_id = up.manager_id
)
SELECT first_name, level FROM up ORDER BY level;
:::

:::exercise
id: cte-calendar
level: 4
title: Every month, even quiet ones
ordered: true
---
Report revenue for **every month of 2025** (January through December), including months with zero revenue. Exclude cancelled orders. Return `month` (`2025-01` format) and `revenue` rounded to 2 decimals (0 for empty months), in order.
---hint
Generate the 12 months with a recursive CTE, then LEFT JOIN a per-month revenue CTE.
---solution
WITH RECURSIVE months(m) AS (
  SELECT '2025-01-01' UNION ALL SELECT DATE(m, '+1 month') FROM months WHERE m < '2025-12-01'
),
rev AS (
  SELECT STRFTIME('%Y-%m', o.order_date) AS month, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY month
)
SELECT STRFTIME('%Y-%m', m) AS month, ROUND(COALESCE(r.revenue, 0), 2) AS revenue
FROM months LEFT JOIN rev r ON r.month = STRFTIME('%Y-%m', m)
ORDER BY month;
:::

:::exercise
id: cte-team-payroll
level: 4
title: Payroll of each VP's org
---
For each employee who reports **directly to the CEO** (Maya), compute the total salary of their entire organization **including themselves**. Return `leader` (first name) and `org_payroll`.
---hint
Recursive CTE that carries the "root" leader along: anchor = direct reports of the CEO with `root = emp_id`; recursive step keeps the same root.
---solution
WITH RECURSIVE tree(emp_id, root, salary) AS (
  SELECT emp_id, emp_id, salary FROM employees WHERE manager_id = 1
  UNION ALL
  SELECT e.emp_id, t.root, e.salary FROM employees e JOIN tree t ON e.manager_id = t.emp_id
)
SELECT l.first_name AS leader, SUM(t.salary) AS org_payroll
FROM tree t JOIN employees l ON l.emp_id = t.root
GROUP BY t.root, l.first_name;
:::

:::exercise
id: proj-sql-11-monthly
level: 3
title: "Project 11: monthly revenue"
ordered: true
---
With a CTE named `lines` that joins `orders` to `order_items` (non-cancelled orders only) and exposes `month` (`YYYY-MM`) and `amount` (quantity × unit price), return each `month` and its `revenue` (rounded to 2 decimals), in month order.
---solution
WITH lines AS (SELECT strftime('%Y-%m', o.order_date) AS month, oi.quantity * oi.unit_price AS amount FROM orders o JOIN order_items oi ON oi.order_id = o.order_id WHERE o.status <> 'cancelled') SELECT month, ROUND(SUM(amount), 2) AS revenue FROM lines GROUP BY month ORDER BY month;
:::

:::exercise
id: proj-sql-11-top-customers
level: 3
title: "Project 11b: top 3 customers by name"
ordered: true
---
Using a CTE `spend` (total non-cancelled spend per `customer_id`), return the `name` and `spent` (rounded to 2 decimals) of the **3** biggest spenders, biggest first.
---solution
WITH spend AS (SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS spent FROM orders o JOIN order_items oi ON oi.order_id = o.order_id WHERE o.status <> 'cancelled' GROUP BY o.customer_id) SELECT c.name, ROUND(s.spent, 2) AS spent FROM spend s JOIN customers c ON c.customer_id = s.customer_id ORDER BY s.spent DESC LIMIT 3;
:::
