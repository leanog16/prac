---
id: sql-boss
title: Boss round: mixed problems
summary: Interview- and exam-style problems that combine everything. Read the problem, sketch the steps, then build the query one CTE at a time.
minutes: 60
---
## How to attack a hard query

Hard SQL problems are rarely about obscure syntax. They're about breaking the question into steps. A reliable method:

1. **Find the grain.** What does one output row represent? A customer? A customer-month? A pair of students?
2. **Find the sources.** Which tables hold the facts, and how do they join? Sketch the key path (customers → orders → order_items → products).
3. **Build bottom-up with CTEs.** Write the innermost step, run it, check the row count, then add the next step.
4. **Watch for the traps.** Fan-out from one-to-many joins inflating SUMs and COUNTs; NULLs in NOT IN; inner joins silently dropping rows; ties at a LIMIT cutoff.
5. **Sanity-check** against a number you can verify by hand.

> [!tip] Patterns that keep showing up
> - *Top N per group* → `ROW_NUMBER()`/`RANK()` over a partition, filter outside.
> - *"Never" / "without"* → anti-join (`LEFT JOIN … IS NULL` or `NOT EXISTS`).
> - *"Every" / "all"* → relational division (double `NOT EXISTS`, or count matching).
> - *Change over time* → `LAG`/`LEAD`, or a self-join on the previous period.
> - *Pivot* → conditional aggregation: `SUM(CASE WHEN … THEN … END)`.
> - *Consecutive runs* → gaps-and-islands with `value - ROW_NUMBER()`.
> - *Median / percentiles* → window functions over the ordered rows.

Here's the method applied to one problem: "for each customer, what share of their spending went to Electronics?"

```sql run
WITH lines AS (                       -- grain: one order line, with category
  SELECT o.customer_id, p.category, oi.quantity * oi.unit_price AS amount
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE o.status <> 'cancelled'
),
per_customer AS (                     -- grain: one customer
  SELECT customer_id,
         SUM(amount) AS total,
         SUM(CASE WHEN category = 'Electronics' THEN amount ELSE 0 END) AS electronics
  FROM lines GROUP BY customer_id
)
SELECT c.name, ROUND(total, 2) AS total, ROUND(100.0 * electronics / total, 1) AS pct_electronics
FROM per_customer pc JOIN customers c ON c.customer_id = pc.customer_id
ORDER BY pct_electronics DESC;
```

Every problem below has a reference solution, hints, and an "Expected output" button. Try each one fully before peeking.

:::exercise
id: boss-second-dept-salary
level: 3
title: Runner-up in every department
---
For each department, find the employee(s) with the **second-highest distinct salary** in that department. Return department `name`, `first_name`, `salary`. Departments with only one distinct salary produce no row.
---hint
DENSE_RANK over a partition by department, ordered by salary descending. Keep rank 2.
---solution
WITH r AS (
  SELECT e.dept_id, e.first_name, e.salary,
         DENSE_RANK() OVER (PARTITION BY e.dept_id ORDER BY e.salary DESC) AS dr
  FROM employees e WHERE e.dept_id IS NOT NULL
)
SELECT d.name, r.first_name, r.salary FROM r JOIN departments d ON d.dept_id = r.dept_id WHERE r.dr = 2;
:::

:::exercise
id: boss-repeat-customers
level: 3
title: Repeat customers
---
Return the `name` of customers who placed orders in **at least three different months** (any status). Also return `months`, the number of distinct months.
---solution
SELECT c.name, COUNT(DISTINCT STRFTIME('%Y-%m', o.order_date)) AS months
FROM customers c JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id, c.name
HAVING COUNT(DISTINCT STRFTIME('%Y-%m', o.order_date)) >= 3;
:::

:::exercise
id: boss-first-order-product
level: 3
title: What did they buy first?
---
For every customer who has ordered, return `name`, their first `order_date`, and `products`: the product names in that first order joined with `, ` in alphabetical order.
---solution
WITH firsts AS (
  SELECT customer_id, MIN(order_date) AS first_date FROM orders GROUP BY customer_id
)
SELECT c.name, f.first_date AS order_date, GROUP_CONCAT(p.name, ', ' ORDER BY p.name) AS products
FROM firsts f
JOIN customers c ON c.customer_id = f.customer_id
JOIN orders o ON o.customer_id = f.customer_id AND o.order_date = f.first_date
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p ON p.product_id = oi.product_id
GROUP BY c.customer_id, c.name, f.first_date;
:::

:::exercise
id: boss-median-salary
level: 4
title: Median salary
---
Compute the **median** salary of all employees as a single value `median`. With an even count, it's the average of the two middle values.
---hint
Number the rows by salary with ROW_NUMBER and count them with COUNT(*) OVER (). The middle rows are those where rn is in ((n+1)/2, (n+2)/2) using integer division.
---solution
WITH s AS (
  SELECT salary, ROW_NUMBER() OVER (ORDER BY salary) AS rn, COUNT(*) OVER () AS n FROM employees
)
SELECT AVG(salary) AS median FROM s WHERE rn IN ((n + 1) / 2, (n + 2) / 2);
:::

:::exercise
id: boss-cohort
level: 4
title: Signup cohorts
ordered: true
---
Group customers by the **year they joined** (`joined`). For each cohort return `cohort` (year as text), `customers` (how many joined), `buyers` (how many have at least one non-cancelled order) and `conversion_pct` (buyers ÷ customers × 100, 1 decimal). Order by cohort.
---solution
SELECT STRFTIME('%Y', c.joined) AS cohort,
       COUNT(*) AS customers,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.status <> 'cancelled') THEN 1 ELSE 0 END) AS buyers,
       ROUND(100.0 * SUM(CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.status <> 'cancelled') THEN 1 ELSE 0 END) / COUNT(*), 1) AS conversion_pct
FROM customers c
GROUP BY cohort
ORDER BY cohort;
:::

:::exercise
id: boss-bought-together
level: 4
title: Frequently bought together
ordered: true
---
Find pairs of products that appear **in the same order** at least twice. Return `product_a` and `product_b` (names, with `product_a`'s id smaller than `product_b`'s), and `orders` = number of orders containing both. Sort by `orders` descending, then `product_a`, then `product_b`.
---hint
Self-join order_items on order_id with `a.product_id < b.product_id`.
---solution
SELECT pa.name AS product_a, pb.name AS product_b, COUNT(*) AS orders
FROM order_items a
JOIN order_items b ON b.order_id = a.order_id AND a.product_id < b.product_id
JOIN products pa ON pa.product_id = a.product_id
JOIN products pb ON pb.product_id = b.product_id
GROUP BY a.product_id, b.product_id
HAVING COUNT(*) >= 2
ORDER BY orders DESC, product_a, product_b;
:::

:::exercise
id: boss-grade-points
level: 4
title: Recompute GPAs from grades
---
Map letter grades to points (`A`=4.0, `A-`=3.7, `B+`=3.3, `B`=3.0, `B-`=2.7, `C+`=2.3, `C`=2.0, `C-`=1.7, `D`=1.0, `F`=0.0) and compute each student's **credit-weighted** GPA over graded enrollments: Σ(points × credits) ÷ Σ(credits). Return `student_id`, `computed_gpa` (2 decimals) and the stored `gpa`, for students with at least one graded course.
---hint
CASE for the mapping; join enrollments to courses for credits; aggregate per student; join students for the stored GPA.
---solution
WITH pts AS (
  SELECT e.student_id, c.credits,
         CASE e.grade WHEN 'A' THEN 4.0 WHEN 'A-' THEN 3.7 WHEN 'B+' THEN 3.3 WHEN 'B' THEN 3.0 WHEN 'B-' THEN 2.7
                      WHEN 'C+' THEN 2.3 WHEN 'C' THEN 2.0 WHEN 'C-' THEN 1.7 WHEN 'D' THEN 1.0 WHEN 'F' THEN 0.0 END AS points
  FROM enrollments e JOIN courses c ON c.course_id = e.course_id
  WHERE e.grade IS NOT NULL
)
SELECT p.student_id, ROUND(SUM(p.points * p.credits) / SUM(p.credits), 2) AS computed_gpa, s.gpa
FROM pts p JOIN students s ON s.student_id = p.student_id
GROUP BY p.student_id, s.gpa;
:::

:::exercise
id: boss-stockout-risk
level: 4
title: Stockout risk
ordered: true
---
For each product **currently in stock**, compute average units sold per non-cancelled order line (`avg_units`, 2 decimals) and `orders_left` = stock ÷ avg_units rounded **down** to an integer: roughly how many more average orders the stock can cover. Return `name`, `stock`, `avg_units`, `orders_left` for products with `orders_left` below 25, lowest first, ties by name. Exclude products never sold.
---solution
WITH sold AS (
  SELECT oi.product_id, AVG(oi.quantity) AS avg_units
  FROM order_items oi JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status <> 'cancelled'
  GROUP BY oi.product_id
)
SELECT p.name, p.stock, ROUND(s.avg_units, 2) AS avg_units, CAST(p.stock / s.avg_units AS INTEGER) AS orders_left
FROM products p JOIN sold s ON s.product_id = p.product_id
WHERE p.stock > 0 AND CAST(p.stock / s.avg_units AS INTEGER) < 25
ORDER BY orders_left, p.name;
:::

:::exercise
id: boss-streak
level: 4
title: Longest monthly streak
---
A customer's "streak" is a run of **consecutive calendar months** with at least one order. Return each customer's `customer_id` and their `longest_streak` (in months), for customers who ordered at all.
---hint
Distinct (customer, month) pairs; convert each month to a number (`year * 12 + month`); then gaps-and-islands: `month_num - ROW_NUMBER() OVER (PARTITION BY customer ORDER BY month_num)` is constant within a streak.
---solution
WITH m AS (
  SELECT DISTINCT customer_id,
         CAST(STRFTIME('%Y', order_date) AS INTEGER) * 12 + CAST(STRFTIME('%m', order_date) AS INTEGER) AS mnum
  FROM orders
),
g AS (
  SELECT customer_id, mnum - ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY mnum) AS grp FROM m
),
runs AS (SELECT customer_id, grp, COUNT(*) AS len FROM g GROUP BY customer_id, grp)
SELECT customer_id, MAX(len) AS longest_streak FROM runs GROUP BY customer_id;
:::

:::exercise
id: boss-pivot-terms
level: 4
title: Enrollment matrix
---
Build a matrix: one row per department (`courses.dept`), with columns `fall_2025`, `spring_2026`, `fall_2026` holding the number of enrollments in that department's courses in each term (0 when none). Include every department that has courses.
---solution
SELECT c.dept,
       SUM(CASE WHEN e.term = 'Fall 2025' THEN 1 ELSE 0 END) AS fall_2025,
       SUM(CASE WHEN e.term = 'Spring 2026' THEN 1 ELSE 0 END) AS spring_2026,
       SUM(CASE WHEN e.term = 'Fall 2026' THEN 1 ELSE 0 END) AS fall_2026
FROM courses c LEFT JOIN enrollments e ON e.course_id = c.course_id
GROUP BY c.dept;
:::

:::exercise
id: boss-no-a
level: 3
title: Never got an A
---
Return `first_name` and `last_name` of students who have **at least one graded enrollment** but have **never** received any grade starting with `A`.
---solution
SELECT s.first_name, s.last_name FROM students s
WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.grade IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.grade LIKE 'A%');
:::

:::exercise
id: boss-salary-bands
level: 3
title: Salary histogram
ordered: true
---
Bucket salaries into bands of 25,000 (`50000-74999`, `75000-99999`, …). Return `band_start` (e.g. 50000), `employees`, and `bar`: a string of `*` characters, one per employee, ordered by band.
---hint
`(salary / 25000) * 25000` floors to the band. For the bar, SQLite has no REPEAT, but `SUBSTR('**********************', 1, COUNT(*))` works.
---solution
SELECT (salary / 25000) * 25000 AS band_start, COUNT(*) AS employees,
       SUBSTR('************************', 1, COUNT(*)) AS bar
FROM employees GROUP BY band_start ORDER BY band_start;
:::
