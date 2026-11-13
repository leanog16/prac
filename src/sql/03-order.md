---
id: sql-order
title: Sorting & limiting
summary: ORDER BY with multiple keys and directions, where NULLs land, LIMIT/OFFSET pagination, and top-N queries.
minutes: 20
---
## ORDER BY

Rows come back in no guaranteed order unless you ask. `ORDER BY` sorts the result:

```sql run
SELECT name, price FROM products ORDER BY price;
```

`ASC` (ascending) is the default; add `DESC` for descending:

```sql run
SELECT name, price FROM products ORDER BY price DESC;
```

## Multiple sort keys

List several keys separated by commas. The second key only breaks ties in the first, the third breaks ties in the second, and so on. **Each key has its own direction.**

```sql run
SELECT dept_id, first_name, salary
FROM employees
ORDER BY dept_id ASC, salary DESC;
```

> [!warn] DESC applies to one column
> `ORDER BY a, b DESC` sorts `a` ascending and only `b` descending. People often expect the `DESC` to apply to both.

## Sorting by expressions, aliases and positions

You can sort by any expression, by a `SELECT` alias (since `ORDER BY` runs after `SELECT`), or by column position:

```sql run
SELECT name, price * stock AS stock_value
FROM products
ORDER BY stock_value DESC;
```

```sql run
SELECT first_name, last_name FROM employees ORDER BY LENGTH(last_name), last_name;
```

`ORDER BY 2` (sort by the second selected column) works too, but it's fragile: reorder the SELECT list and the sort silently changes.

## Where do NULLs go?

In SQLite and MySQL, NULLs sort **first** in ascending order (they're treated as smaller than any value). PostgreSQL and Oracle put them **last**. Be explicit with `NULLS FIRST` / `NULLS LAST` (supported by SQLite 3.30+ and PostgreSQL):

```sql run
SELECT first_name, gpa FROM students ORDER BY gpa DESC NULLS LAST;
```

## Text sorting

Text sorts by character code by default, so uppercase letters come before lowercase (`'Z' < 'a'`). For case-insensitive ordering: `ORDER BY name COLLATE NOCASE` (SQLite) or `ORDER BY LOWER(name)`.

## LIMIT and OFFSET

`LIMIT n` keeps the first `n` rows *after sorting*; `OFFSET k` skips `k` rows first. Together they implement pagination: page `p` (starting at 1) with page size `s` is `LIMIT s OFFSET (p - 1) * s`.

```sql run
-- the three most expensive products
SELECT name, price FROM products ORDER BY price DESC LIMIT 3;
```

```sql run
-- "page 2" of products by name, 5 per page
SELECT name FROM products ORDER BY name LIMIT 5 OFFSET 5;
```

> [!exam] Ties at the cutoff
> "Top 3 salaries" with `LIMIT 3` gives exactly 3 rows even if the 3rd and 4th tie. If ties should all be included, you need a window function (`RANK()`), covered later. Also: `LIMIT` without `ORDER BY` gives you *some* rows, not the "first" ones.

Other databases spell it differently: `SELECT TOP 3` (SQL Server), `FETCH FIRST 3 ROWS ONLY` (standard SQL, PostgreSQL, Oracle 12c+).

:::quiz
q: `ORDER BY dept_id, salary DESC` sorts…
- both columns descending
+ dept_id ascending, then salary descending within each dept
- salary descending, then dept_id ascending
- by dept_id only; salary is ignored
why: Each sort key has its own direction; ASC is the default.
:::

:::quiz
q: In SQLite, where do NULLs appear in `ORDER BY gpa ASC`?
+ First
- Last
- They're excluded
- Random positions
why: SQLite treats NULL as smaller than any value. Use NULLS LAST to change that.
:::

:::quiz
q: Which query returns rows 21–30 of a sorted list?
- `LIMIT 20 OFFSET 10`
+ `LIMIT 10 OFFSET 20`
- `LIMIT 30 OFFSET 20`
- `OFFSET 20 LIMIT 30`
why: Skip 20 rows (OFFSET 20), then take 10 (LIMIT 10).
:::

:::quiz
q: Why can you use a SELECT alias in ORDER BY but not (portably) in WHERE?
- ORDER BY is processed before SELECT
+ ORDER BY is processed after SELECT computes the aliases; WHERE runs before
- Aliases only work for numeric columns
- It's a SQLite-only quirk
why: Logical order: FROM, WHERE, GROUP BY, HAVING, SELECT, ORDER BY, LIMIT.
:::

:::exercise
id: ord-price-asc
level: 1
title: Cheapest first
ordered: true
---
List product `name` and `price`, cheapest first. (For equal prices, order doesn't matter.)
---solution
SELECT name, price FROM products ORDER BY price;
:::

:::exercise
id: ord-newest-hires
level: 1
title: Newest hires
ordered: true
---
Show `first_name`, `last_name`, `hire_date` for all employees, most recently hired first.
---solution
SELECT first_name, last_name, hire_date FROM employees ORDER BY hire_date DESC;
:::

:::exercise
id: ord-top3-gpa
level: 2
title: Top three GPAs
ordered: true
---
Return `first_name`, `last_name` and `gpa` of the three students with the highest GPA, highest first.
---hint
NULLs sort first in ascending order in SQLite. In descending order, where do they go?
---solution
SELECT first_name, last_name, gpa FROM students ORDER BY gpa DESC LIMIT 3;
:::

:::exercise
id: ord-multi
level: 2
title: Department roster
ordered: true
---
List `dept_id`, `last_name`, `first_name` for employees **that have a department**, sorted by `dept_id` ascending, then by `last_name` alphabetically.
---solution
SELECT dept_id, last_name, first_name FROM employees WHERE dept_id IS NOT NULL ORDER BY dept_id, last_name;
:::

:::exercise
id: ord-mixed-dir
level: 2
title: Seniors first, best GPAs first
ordered: true
---
Show `first_name`, `year`, `gpa` for all students with a known GPA, ordered by `year` **descending** and then `gpa` **descending**, breaking any remaining ties by `first_name` alphabetically.
---solution
SELECT first_name, year, gpa FROM students WHERE gpa IS NOT NULL ORDER BY year DESC, gpa DESC, first_name;
:::

:::exercise
id: ord-page3
level: 3
title: Page three
ordered: true
---
Customers are shown 4 per page, sorted by `name`. Return the `customer_id` and `name` of everyone on **page 3**.
---hint
Page p with size s: `LIMIT s OFFSET (p - 1) * s`.
---solution
SELECT customer_id, name FROM customers ORDER BY name LIMIT 4 OFFSET 8;
:::

:::exercise
id: ord-expr
level: 3
title: Biggest stockpiles by value
ordered: true
---
Show each product's `name` and `stock_value` (price × stock), largest value first. Only include the top 5.
---solution
SELECT name, price * stock AS stock_value FROM products ORDER BY stock_value DESC LIMIT 5;
:::

:::exercise
id: ord-nulls-last
level: 3
title: GPA leaderboard, missing at the bottom
ordered: true
---
List every student's `first_name` and `gpa` from lowest GPA to highest, but students **without** a GPA must appear at the **end**. Break ties by `first_name`.
---hint
`NULLS LAST`, or sort first by `gpa IS NULL` (0 before 1).
---solution
SELECT first_name, gpa FROM students ORDER BY gpa ASC NULLS LAST, first_name;
:::

:::exercise
id: ord-second-highest
level: 4
title: Runner-up salary
---
Return the **second-highest distinct salary** in the company as a single value. (If two people tied for first, the runner-up is the next lower amount.)
---hint
`SELECT DISTINCT salary … ORDER BY … LIMIT 1 OFFSET 1`
---solution
SELECT DISTINCT salary FROM employees ORDER BY salary DESC LIMIT 1 OFFSET 1;
:::
