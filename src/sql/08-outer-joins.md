---
id: sql-outer
title: Outer, self & cross joins
summary: LEFT/RIGHT/FULL joins that keep unmatched rows, the anti-join pattern, ON-vs-WHERE with outer joins, self-joins for hierarchies, and CROSS joins.
minutes: 35
---
## LEFT JOIN keeps every left row

An inner join drops rows with no partner. A **LEFT (OUTER) JOIN** keeps every row from the left table; where no right row matches, the right side's columns are filled with **NULL**.

```sql run
SELECT d.name, e.first_name
FROM departments d
LEFT JOIN employees e ON e.dept_id = d.dept_id
ORDER BY d.name;
```

Research appears with `first_name = NULL`: it has no employees, but the left join kept it.

| Join | Keeps unmatched rows from |
|---|---|
| `INNER JOIN` | neither table |
| `LEFT JOIN` | the left (first) table |
| `RIGHT JOIN` | the right (second) table |
| `FULL JOIN` | both tables |

`RIGHT JOIN` is just a LEFT JOIN with the tables swapped; most people always write LEFT. `FULL OUTER JOIN` is supported in SQLite 3.39+, PostgreSQL and SQL Server, but **not MySQL**.

## Counting with outer joins

"Headcount per department, including empty departments." Note `COUNT(e.emp_id)`, not `COUNT(*)`:

```sql run
SELECT d.name, COUNT(*) AS wrong, COUNT(e.emp_id) AS right
FROM departments d
LEFT JOIN employees e ON e.dept_id = d.dept_id
GROUP BY d.dept_id, d.name;
```

Research has one joined row (with NULLs), so `COUNT(*)` says 1. `COUNT(e.emp_id)` counts only real matches: 0.

## The anti-join: rows with *no* match

To find rows in A with no partner in B, left join and keep the rows where B's key is NULL:

```sql run
-- customers who have never placed an order
SELECT c.name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.order_id IS NULL;
```

This is one of the most common real-world query patterns. (`NOT EXISTS` expresses the same thing; see the subqueries module.)

## ON vs WHERE: it matters now

For outer joins, conditions in `ON` decide *which rows match*; conditions in `WHERE` filter *after* the join, and can throw away the NULL-extended rows you were trying to keep.

```sql run
-- Every customer, with their count of DELIVERED orders (0 if none)
SELECT c.name, COUNT(o.order_id) AS delivered
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'delivered'
GROUP BY c.customer_id, c.name;
```

```sql run
-- Oops: WHERE removes customers with no delivered orders entirely
SELECT c.name, COUNT(o.order_id) AS delivered
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
WHERE o.status = 'delivered'
GROUP BY c.customer_id, c.name;
```

> [!exam] The silent outer-join killer
> A `WHERE` condition on the *right* table of a LEFT JOIN (other than `IS NULL`) turns it back into an inner join, because NULL-extended rows fail the condition. Put right-table filters in `ON`.

## Self-joins

A table can be joined to itself, using two different aliases. `employees.manager_id` refers back to `employees.emp_id`, so to show each person next to their manager:

```sql run
SELECT e.first_name AS employee, m.first_name AS manager
FROM employees e
LEFT JOIN employees m ON m.emp_id = e.manager_id;
```

The LEFT JOIN keeps Maya, who has no manager. Self-joins also answer "pairs" questions: employees who earn more than their manager, students in the same major, products in the same category.

```sql run
SELECT e.first_name, e.salary, m.first_name AS manager, m.salary AS manager_salary
FROM employees e
JOIN employees m ON m.emp_id = e.manager_id
WHERE e.salary > m.salary * 0.9;
```

To list each unordered pair once, use `a.id < b.id` instead of `<>`, which would list every pair twice (A–B and B–A).

## CROSS JOIN

`CROSS JOIN` returns every combination: useful for generating grids (every department × every year, every product × every size) that you then LEFT JOIN facts onto.

```sql run
SELECT d.name, t.term
FROM departments d
CROSS JOIN (SELECT DISTINCT term FROM enrollments) t
LIMIT 8;
```

## Non-equi joins

Join conditions can use any comparison, not just `=`. Match each order to the price band it falls in, or each employee to everyone hired before them:

```sql run
SELECT a.first_name, COUNT(b.emp_id) AS hired_earlier
FROM employees a
LEFT JOIN employees b ON b.hire_date < a.hire_date
GROUP BY a.emp_id, a.first_name
ORDER BY hired_earlier
LIMIT 6;
```

:::quiz
q: `departments LEFT JOIN employees` — what happens to a department with no employees?
- It's dropped
+ It appears once, with NULL in all employee columns
- It appears once per employee in the company
- The query errors
why: LEFT JOIN keeps every left row; unmatched rows are NULL-extended.
:::

:::quiz
q: You LEFT JOIN customers to orders, then add `WHERE o.status = 'shipped'`. What happens to customers with no orders?
- They appear with NULL status
+ They disappear, because NULL = 'shipped' is not true
- They appear with status 'shipped'
- An error is raised
why: The WHERE runs after the join and rejects NULL-extended rows. Move the condition into ON to keep them.
:::

:::quiz
q: Which finds products that have never been ordered?
- `products JOIN order_items … WHERE oi.product_id IS NULL`
+ `products LEFT JOIN order_items … WHERE oi.product_id IS NULL`
- `products LEFT JOIN order_items … WHERE oi.product_id IS NOT NULL`
- `products CROSS JOIN order_items`
why: An inner join can't produce NULLs on the right; you need a LEFT JOIN plus an IS NULL test on the right table's key.
:::

:::quiz
q: In a self-join listing pairs of employees in the same city, why use `a.emp_id < b.emp_id` rather than `<>`?
+ To list each pair once instead of twice
- Because `<>` is invalid in joins
- To exclude NULL cities
- It's faster but gives the same rows
why: `<>` produces both (A, B) and (B, A). `<` keeps only one ordering.
:::

:::quiz
q: With a LEFT JOIN, which counts only real matches?
- `COUNT(*)`
+ `COUNT(right_table.primary_key)`
- `COUNT(left_table.primary_key)`
- `SUM(1)`
why: Unmatched rows have NULL in the right table's columns, and COUNT(column) skips NULLs.
:::

:::exercise
id: oj-all-depts
level: 1
title: Every department, staffed or not
---
List every department `name` with the `first_name` of each of its employees. Departments with no one should still appear (with NULL).
---solution
SELECT d.name, e.first_name FROM departments d LEFT JOIN employees e ON e.dept_id = d.dept_id;
:::

:::exercise
id: oj-never-ordered
level: 1
title: Products never ordered
---
Return the `name` of every product that has never appeared in any order.
---solution
SELECT p.name FROM products p LEFT JOIN order_items oi ON oi.product_id = p.product_id WHERE oi.product_id IS NULL;
:::

:::exercise
id: oj-no-enrollments
level: 2
title: Not registered
---
Find students who have **no enrollments at all**. Return `student_id`, `first_name`, `last_name`.
---solution
SELECT s.student_id, s.first_name, s.last_name
FROM students s LEFT JOIN enrollments e ON e.student_id = s.student_id
WHERE e.student_id IS NULL;
:::

:::exercise
id: oj-dept-count-zero
level: 2
title: Headcount including zero
---
Return every department `name` and its number of employees as `n`, showing **0** for empty departments.
---hint
`COUNT(*)` would report 1 for the empty department.
---solution
SELECT d.name, COUNT(e.emp_id) AS n FROM departments d LEFT JOIN employees e ON e.dept_id = d.dept_id GROUP BY d.dept_id, d.name;
:::

:::exercise
id: oj-manager-names
level: 2
title: Who's your boss?
---
For every employee, return `employee` (their first name) and `manager` (their manager's first name, NULL for the CEO).
---solution
SELECT e.first_name AS employee, m.first_name AS manager FROM employees e LEFT JOIN employees m ON m.emp_id = e.manager_id;
:::

:::exercise
id: oj-course-enrollment
level: 2
title: Enrollment per course, including empty
---
Return every course `code` and the number of enrollment rows as `enrolled` (0 if none).
---solution
SELECT c.code, COUNT(e.course_id) AS enrolled FROM courses c LEFT JOIN enrollments e ON e.course_id = c.course_id GROUP BY c.course_id, c.code;
:::

:::exercise
id: oj-on-vs-where
level: 3
title: Delivered orders per customer
---
Return **every** customer's `name` and the number of their orders with status `delivered` as `delivered` (0 for customers with none, including customers who never ordered).
---hint
The status filter must not remove the NULL-extended rows. Where should it go?
---solution
SELECT c.name, COUNT(o.order_id) AS delivered
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'delivered'
GROUP BY c.customer_id, c.name;
:::

:::exercise
id: oj-earn-more-than-boss
level: 3
title: Closing in on the boss
---
Find employees whose salary is **at least 80%** of their direct manager's salary. Return `employee`, `salary`, `manager`, `manager_salary`.
---hint
Self-join `employees e` to `employees m ON m.emp_id = e.manager_id`, then compare in WHERE.
---solution
SELECT e.first_name AS employee, e.salary, m.first_name AS manager, m.salary AS manager_salary
FROM employees e JOIN employees m ON m.emp_id = e.manager_id
WHERE e.salary >= 0.8 * m.salary;
:::

:::exercise
id: oj-skip-level
level: 3
title: Skip-level managers
---
For each employee, show `employee`, `manager` and `grand_manager` (the manager's manager). Keep everyone, with NULLs where a level doesn't exist.
---hint
Join employees three times with three aliases.
---solution
SELECT e.first_name AS employee, m.first_name AS manager, g.first_name AS grand_manager
FROM employees e
LEFT JOIN employees m ON m.emp_id = e.manager_id
LEFT JOIN employees g ON g.emp_id = m.manager_id;
:::

:::exercise
id: oj-direct-reports
level: 3
title: Span of control
ordered: true
---
List every employee who manages at least one person: `manager` first name and number of direct `reports`, most reports first, ties by name.
---solution
SELECT m.first_name AS manager, COUNT(*) AS reports
FROM employees e JOIN employees m ON m.emp_id = e.manager_id
GROUP BY m.emp_id, m.first_name
ORDER BY reports DESC, manager;
:::

:::exercise
id: oj-same-major-pairs
level: 3
title: Study buddies
---
Pair up **Physics** majors with each other. Return `a` and `b` (first names), listing each pair **once**.
---solution
SELECT s1.first_name AS a, s2.first_name AS b
FROM students s1 JOIN students s2 ON s1.major = s2.major AND s1.student_id < s2.student_id
WHERE s1.major = 'Physics';
:::

:::exercise
id: oj-full-join
level: 4
title: Reconcile two lists
---
Compare the cities where **customers** live with the cities where **employees** live. Return one row per distinct city with columns `city`, `customers` (count) and `employees` (count), including cities that appear in only one list (count 0 there). Ignore NULL cities.
---hint
Aggregate each side first in a subquery, then FULL JOIN the two summaries on city.
---hint
`COALESCE(a.city, b.city)` gives the city from whichever side exists.
---solution
SELECT COALESCE(c.city, e.city) AS city, COALESCE(c.n, 0) AS customers, COALESCE(e.n, 0) AS employees
FROM (SELECT city, COUNT(*) AS n FROM customers WHERE city IS NOT NULL GROUP BY city) c
FULL JOIN (SELECT city, COUNT(*) AS n FROM employees WHERE city IS NOT NULL GROUP BY city) e
  ON e.city = c.city;
:::

:::exercise
id: oj-grid
level: 4
title: Category × status grid
---
Build a complete grid of every product `category` × every order `status`, with `items` = total quantity sold for that combination (**0** where nothing was sold). Return `category`, `status`, `items`.
---hint
CROSS JOIN the distinct categories with the distinct statuses, then LEFT JOIN the facts onto the grid.
---solution
SELECT g.category, g.status, COALESCE(SUM(f.quantity), 0) AS items
FROM (SELECT DISTINCT p.category, s.status FROM products p CROSS JOIN (SELECT DISTINCT status FROM orders) s) g
LEFT JOIN (SELECT p.category, o.status, oi.quantity
           FROM order_items oi
           JOIN products p ON p.product_id = oi.product_id
           JOIN orders o ON o.order_id = oi.order_id) f
  ON f.category = g.category AND f.status = g.status
GROUP BY g.category, g.status;
:::
