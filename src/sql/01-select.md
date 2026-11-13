---
id: sql-select
title: Tables & SELECT
summary: How relational data is shaped, and how to pull columns, expressions and distinct values out of a table.
minutes: 25
---
## The relational model in five minutes

A relational database stores data in **tables** (formally, *relations*). Every table has a fixed set of named **columns**, each with a type, and any number of **rows**. A row is one fact: one employee, one order, one enrollment.

| Term | Also called | Example in this course |
|---|---|---|
| table | relation | `employees` |
| row | record, tuple | Priya Shah's employee record |
| column | attribute, field | `salary` |
| primary key | PK | `emp_id` uniquely identifies a row |
| foreign key | FK | `employees.dept_id` points at `departments.dept_id` |

Two ideas matter more than anything else:

1. **Rows have no inherent order.** A table is a *set* of rows. If you need an order, you must ask for it with `ORDER BY`.
2. **Keys connect tables.** Instead of copying a department's name into every employee row, each employee stores a `dept_id`, and you *join* to `departments` to get the name. That's the whole game of relational design.

> [!note] The practice database
> Every query on this site runs against a real SQLite database living in your browser. It has three little worlds: a **company** (`departments`, `employees`), a **university** (`students`, `courses`, `instructors`, `enrollments`) and a **store** (`customers`, `products`, `orders`, `order_items`). Open the [schema reference](#sql-schema) any time.

## Your first query

`SELECT` describes *what* you want; the database figures out *how*. The smallest useful query names columns and a table:

```sql run
SELECT first_name, last_name, title
FROM employees;
```

Hit **Run** on any block like this to see the real result. `SELECT *` means "every column", which is handy for exploring but a bad habit in real code: it breaks when columns are added and it hides what you depend on.

```sql run
SELECT * FROM departments;
```

> [!tip] Style that graders and coworkers like
> SQL keywords are case-insensitive (`select` = `SELECT`), but the convention is UPPERCASE keywords, lowercase names, one clause per line. End statements with `;`.

## Expressions and aliases

A `SELECT` list can hold *expressions*, not just columns. Arithmetic, string concatenation (`||` in SQLite and standard SQL) and function calls all work. Name a computed column with `AS`:

```sql run
SELECT first_name || ' ' || last_name AS full_name,
       salary,
       salary / 12 AS monthly,
       ROUND(salary * 1.03) AS after_raise
FROM employees;
```

Notice `salary / 12`: both sides are integers, so SQLite does **integer division** and drops the remainder. Write `salary / 12.0` to get a decimal. This trips people up on exams constantly.

```sql run
SELECT 7 / 2 AS int_division, 7 / 2.0 AS real_division, 7 % 2 AS remainder;
```

Yes, you can `SELECT` without a `FROM`. It's a quick calculator.

## DISTINCT

`DISTINCT` removes duplicate *rows* from the result. It applies to the whole row, not one column:

```sql run
SELECT DISTINCT city FROM employees;
```

```sql run
SELECT DISTINCT dept_id, city FROM employees;
```

The second query returns each unique *combination* of `dept_id` and `city`. Also note the `NULL` city: `DISTINCT` treats all NULLs as one value.

## Limiting output

`LIMIT n` returns at most `n` rows. Without `ORDER BY`, *which* rows you get is unspecified, so `LIMIT` is mostly paired with sorting (next lessons).

```sql run
SELECT name, price FROM products LIMIT 5;
```

## How a SELECT is evaluated

Even though you *write* `SELECT` first, the database logically processes clauses in this order. Memorize it; it explains half of all SQL error messages.

| Step | Clause | What happens |
|---|---|---|
| 1 | `FROM` / `JOIN` | build the working set of rows |
| 2 | `WHERE` | keep rows that pass the filter |
| 3 | `GROUP BY` | collapse rows into groups |
| 4 | `HAVING` | keep groups that pass |
| 5 | `SELECT` | compute output columns, aliases |
| 6 | `DISTINCT` | remove duplicate rows |
| 7 | `ORDER BY` | sort |
| 8 | `LIMIT` / `OFFSET` | trim |

> [!exam] Why this matters
> Because `WHERE` runs before `SELECT`, you can't use a column alias in `WHERE` (in standard SQL). But `ORDER BY` runs after, so aliases work there.

:::quiz
q: A table is best described as…
- an ordered list of rows
+ an unordered set of rows with a fixed set of columns
- a spreadsheet where row order is significant
- a collection of documents with flexible fields
why: Relational tables have no inherent row order. Order only exists when you ask for it with ORDER BY.
:::

:::quiz
q: What does `SELECT 9 / 4;` return in SQLite?
- 2.25
+ 2
- 3
- an error
why: Both operands are integers, so it's integer division. Use 9 / 4.0 for 2.25.
:::

:::quiz
q: `SELECT DISTINCT a, b FROM t` removes rows where…
- `a` is duplicated
- `b` is duplicated
+ the pair (a, b) is duplicated
- either column is NULL
why: DISTINCT applies to entire result rows, so only identical (a, b) combinations collapse.
:::

:::quiz
q: In logical processing order, which clause runs immediately after `WHERE`?
- SELECT
+ GROUP BY
- ORDER BY
- HAVING
why: FROM, WHERE, GROUP BY, HAVING, SELECT, DISTINCT, ORDER BY, LIMIT.
:::

:::exercise
id: sel-all-depts
level: 1
title: Everything about departments
---
Return every column of every row in the `departments` table.
---hint
`*` means all columns.
---solution
SELECT * FROM departments;
:::

:::exercise
id: sel-names-titles
level: 1
title: Names and titles
---
List each employee's `first_name`, `last_name` and `title`, in that column order.
---hint
List the columns after SELECT, separated by commas.
---solution
SELECT first_name, last_name, title FROM employees;
:::

:::exercise
id: sel-product-catalog
level: 1
title: Product catalog
---
Show the `name`, `category` and `price` of every product.
---solution
SELECT name, category, price FROM products;
:::

:::exercise
id: sel-full-name
level: 2
title: Build a full name
---
Return one column called `full_name` containing each student's first and last name separated by a single space (e.g. `Liam Smith`).
---hint
SQLite concatenates strings with `||`.
---hint
`first_name || ' ' || last_name AS full_name`
---solution
SELECT first_name || ' ' || last_name AS full_name FROM students;
:::

:::exercise
id: sel-inventory-value
level: 2
title: Inventory value
---
For every product, show `name`, `price`, `stock`, and a computed column `inventory_value` equal to price times stock.
---solution
SELECT name, price, stock, price * stock AS inventory_value FROM products;
:::

:::exercise
id: sel-distinct-majors
level: 2
title: Which majors exist?
---
List each distinct `major` in the `students` table, one per row. (A NULL major counts as its own value; that's fine.)
---solution
SELECT DISTINCT major FROM students;
:::

:::exercise
id: sel-monthly-decimal
level: 3
title: Monthly pay, to the cent
---
Show each employee's `first_name`, their annual `salary`, and `monthly` pay rounded to 2 decimal places. Watch out for integer division.
---hint
`salary / 12` truncates because both are integers. Divide by `12.0`.
---hint
`ROUND(x, 2)` rounds to two decimals.
---solution
SELECT first_name, salary, ROUND(salary / 12.0, 2) AS monthly FROM employees;
:::

:::exercise
id: sel-distinct-pairs
level: 3
title: Building and budget pairs
---
Return the distinct combinations of `building` and the department `budget` divided by 1000 (call it `budget_k`, integer division is fine) from `departments`.
---solution
SELECT DISTINCT building, budget / 1000 AS budget_k FROM departments;
:::

:::exercise
id: sel-calculator
level: 1
title: SQL as a calculator
---
Without using any table, return a single row with three columns: `a` = 17 divided by 5 (integer division), `b` = 17 divided by 5 as a decimal (3.4), and `c` = the remainder of 17 divided by 5.
---solution
SELECT 17 / 5 AS a, 17 / 5.0 AS b, 17 % 5 AS c;
:::
