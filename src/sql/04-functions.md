---
id: sql-functions
title: Functions, CASE & types
summary: String, number and date functions, CASE expressions for conditional logic, COALESCE/NULLIF, and type conversion with CAST.
minutes: 30
---
> [!project] Desk & Co, step 4: price bands and months
> Maya thinks in **price bands** (budget, mid-range, premium) and **months**, not raw numbers and dates. `CASE` and the date functions turn raw columns into the labels she uses.

## Scalar functions

A **scalar function** takes values from one row and returns one value. (Contrast with *aggregate* functions like `SUM`, which collapse many rows; that's the next-but-one module.) Function names differ between databases; this site uses SQLite, and the table notes common equivalents.

### Strings

| Function | Result | Notes |
|---|---|---|
| `UPPER(s)`, `LOWER(s)` | change case | |
| `LENGTH(s)` | number of characters | `LEN` in SQL Server |
| `SUBSTR(s, start, len)` | substring, **1-based** | `SUBSTRING` elsewhere |
| `INSTR(s, find)` | position of `find` (1-based), 0 if absent | `POSITION`/`CHARINDEX` elsewhere |
| `REPLACE(s, from, to)` | replace all occurrences | |
| `TRIM(s)`, `LTRIM`, `RTRIM` | strip whitespace | |
| `a \|\| b` | concatenate | `CONCAT(a, b)` in MySQL/SQL Server |

```sql run
SELECT name,
       UPPER(name)              AS shout,
       LENGTH(name)             AS len,
       SUBSTR(name, 1, 3)       AS first3,
       INSTR(name, ' ')         AS space_at,
       REPLACE(name, ' ', '_')  AS slug
FROM products LIMIT 5;
```

Combining `SUBSTR` and `INSTR` splits strings. Everything before the first space:

```sql run
SELECT name, SUBSTR(name, 1, INSTR(name, ' ') - 1) AS first_word
FROM customers;
```

And the domain part of an email (everything after `@`):

```sql run
SELECT email, SUBSTR(email, INSTR(email, '@') + 1) AS domain
FROM customers WHERE email IS NOT NULL;
```

### Numbers

| Function | Example | Result |
|---|---|---|
| `ROUND(x, d)` | `ROUND(3.14159, 2)` | 3.14 |
| `ABS(x)` | `ABS(-7)` | 7 |
| `x % y` | `17 % 5` | 2 (remainder) |
| `CAST(x AS INTEGER)` | `CAST(3.9 AS INTEGER)` | 3 (truncates) |
| `MAX(a, b)` / `MIN(a, b)` | two+ args = scalar in SQLite | larger/smaller value |

```sql run
SELECT ROUND(2.5), ROUND(-2.5), CAST(7.9 AS INTEGER), ABS(-12), 10 % 3, MAX(3, 8, 5);
```

### Dates

SQLite has no date type: dates are stored as ISO text (`'2025-03-17'`), and functions interpret them.

| Function | Example | Result |
|---|---|---|
| `DATE(d, modifier…)` | `DATE('2025-01-31', '+1 month')` | `2025-03-03` |
| `STRFTIME(fmt, d)` | `STRFTIME('%Y', '2025-03-17')` | `'2025'` (text!) |
| `JULIANDAY(d)` | `JULIANDAY(b) - JULIANDAY(a)` | days between |
| `DATE('now')` | today's date | |

Common `STRFTIME` codes: `%Y` year, `%m` month (01–12), `%d` day, `%w` weekday (0 = Sunday), `%j` day of year, `%H:%M` time.

```sql run
SELECT order_date,
       STRFTIME('%Y-%m', order_date)  AS month,
       STRFTIME('%w', order_date)     AS weekday,
       DATE(order_date, '+30 days')   AS due,
       CAST(JULIANDAY('2025-12-31') - JULIANDAY(order_date) AS INTEGER) AS days_to_year_end
FROM orders LIMIT 5;
```

> [!warn] STRFTIME returns text
> `STRFTIME('%Y', hire_date) = 2019` compares text to a number, which is false in SQLite. Compare to `'2019'`, or `CAST(STRFTIME('%Y', hire_date) AS INTEGER) = 2019`.

## CASE: if/else inside a query

`CASE` is an *expression*: it produces a value, so it can go anywhere a value can (SELECT, WHERE, ORDER BY, inside aggregates).

**Searched CASE** tests conditions top to bottom and returns the first match:

```sql run
SELECT first_name, gpa,
       CASE
         WHEN gpa >= 3.5 THEN 'honors'
         WHEN gpa >= 2.5 THEN 'good standing'
         WHEN gpa IS NULL THEN 'no GPA yet'
         ELSE 'probation'
       END AS standing
FROM students;
```

**Simple CASE** compares one expression to values:

```sql run
SELECT code,
       CASE dept WHEN 'CSC' THEN 'Computer Science'
                 WHEN 'MA'  THEN 'Mathematics'
                 ELSE dept END AS department
FROM courses;
```

Without `ELSE`, unmatched rows get NULL. Order matters: put the most specific conditions first.

A classic trick is **custom sort orders** with CASE in ORDER BY:

```sql run
SELECT order_id, status FROM orders
ORDER BY CASE status WHEN 'pending' THEN 1 WHEN 'shipped' THEN 2
                     WHEN 'delivered' THEN 3 ELSE 4 END, order_id
LIMIT 12;
```

SQLite also has `IIF(cond, a, b)`, shorthand for a two-way CASE.

## COALESCE and NULLIF

`COALESCE(a, b, c, …)` returns the first non-NULL argument: the standard way to supply defaults.

```sql run
SELECT first_name, COALESCE(city, 'Remote') AS city, COALESCE(email, 'no email') AS email
FROM employees WHERE city IS NULL OR email IS NULL;
```

`NULLIF(a, b)` returns NULL if `a = b`, otherwise `a`. Its killer use is avoiding division by zero:

```sql run
SELECT name, price, stock, ROUND(price / NULLIF(stock, 0), 2) AS price_per_unit_in_stock
FROM products;
```

## Types and CAST

SQLite uses *dynamic typing*: a column has a type affinity, but each value carries its own type (`typeof(x)` shows it). Other databases are strict. `CAST(x AS type)` converts explicitly:

```sql run
SELECT CAST('42' AS INTEGER) + 1, CAST(10 AS REAL) / 4, typeof('3'), typeof(3), typeof(3.0), typeof(NULL);
```

## Worked example: from a requirement to a CASE expression

Requirement: "label each product *budget* under $30, *mid-range* from $30 to under $100, *premium* from $100".

First write the conditions as a table, checking the boundaries:

| price | band |
|---|---|
| 29.99 | budget |
| 30.00 | mid-range |
| 99.99 | mid-range |
| 100.00 | premium |

Then translate top to bottom. `CASE` checks `WHEN` branches **in order** and stops at the first true one, so each branch only needs the upper bound:

```sql run
SELECT name, price,
       CASE
         WHEN price < 30  THEN 'budget'
         WHEN price < 100 THEN 'mid-range'
         ELSE 'premium'
       END AS band
FROM products
ORDER BY price;
```

## Dates in SQLite

SQLite stores dates as text (`'2025-07-14'`), and the `strftime` function pulls parts out:

```sql run
SELECT order_id, order_date,
       strftime('%Y-%m', order_date) AS month,
       strftime('%w', order_date)    AS weekday,      -- 0 = Sunday
       julianday('2025-12-31') - julianday(order_date) AS days_before_year_end
FROM orders
LIMIT 5;
```

Other databases spell it differently (`EXTRACT(MONTH FROM d)` and `DATE_TRUNC('month', d)` in PostgreSQL, `DATE_FORMAT` in MySQL), but the idea is the same.

## Common mistakes

> [!mistake] Integer division
> In SQLite, `7 / 2` is `3`: two integers give an integer. Write `7 / 2.0` or `CAST(x AS REAL) / y` when you want a fraction. This bites percentages constantly.

> [!mistake] CASE without ELSE
> A row that matches no `WHEN` gets `NULL`. Usually you want an explicit `ELSE`.

- `ROUND(x, 2)` rounds for display; do the math first, round last.
- `COALESCE(a, b)` returns the first non-NULL argument.

:::quiz
q: `SUBSTR('database', 1, 4)` returns…
- `'atab'`
+ `'data'`
- `'base'`
- `'datab'`
why: SQL string positions are 1-based: start at character 1, take 4 characters.
:::

:::quiz
q: A CASE expression with no ELSE and no matching WHEN returns…
- an error
- an empty string
+ NULL
- 0
why: The implicit ELSE is NULL.
:::

:::quiz
q: `COALESCE(NULL, NULL, 'x', 'y')` is…
- NULL
+ `'x'`
- `'y'`
- `'xy'`
why: COALESCE returns its first non-NULL argument.
:::

:::quiz
q: What is the main use of `NULLIF(stock, 0)` in `price / NULLIF(stock, 0)`?
- convert NULL stock to 0
+ turn a zero divisor into NULL so the division yields NULL instead of an error/garbage
- remove rows with zero stock
- round the result
why: Dividing by NULL gives NULL, which is a safe "undefined".
:::

:::quiz
q: In SQLite, `STRFTIME('%Y', '2019-05-01') = 2019` is…
- true
+ false, because STRFTIME returns text and text never equals an integer
- an error
- NULL
why: Compare to the string '2019' or CAST the result to INTEGER.
:::

:::exercise
id: fn-upper-codes
level: 1
title: Shouting product names
---
Return each product's `name` in all capital letters as a column called `name_upper`.
---solution
SELECT UPPER(name) AS name_upper FROM products;
:::

:::exercise
id: fn-name-length
level: 1
title: Long names
---
Return `name` and its character count (call it `len`) for products whose name is **longer than 12 characters**.
---solution
SELECT name, LENGTH(name) AS len FROM products WHERE LENGTH(name) > 12;
:::

:::exercise
id: fn-email-domain
level: 2
title: Email domains
---
For customers with an email, return `name` and the part of the email **after the `@`** as `domain`.
---hint
`INSTR(email, '@')` gives the position of the `@`.
---solution
SELECT name, SUBSTR(email, INSTR(email, '@') + 1) AS domain FROM customers WHERE email IS NOT NULL;
:::

:::exercise
id: fn-initials
level: 2
title: Initials
---
Return every employee's initials as a single column `initials`, like `MP` for Maya Patel.
---solution
SELECT SUBSTR(first_name, 1, 1) || SUBSTR(last_name, 1, 1) AS initials FROM employees;
:::

:::exercise
id: fn-hire-year
level: 2
title: Hired in 2019
---
List `first_name` and `hire_date` for employees hired in **2019**, using `STRFTIME` (not LIKE or BETWEEN).
---hint
STRFTIME returns text. Compare to `'2019'`.
---solution
SELECT first_name, hire_date FROM employees WHERE STRFTIME('%Y', hire_date) = '2019';
:::

:::exercise
id: fn-price-band
level: 2
title: Price bands
---
Label every product with a `band`: `budget` if under 20, `mid` if 20 up to (not including) 100, and `premium` for 100 or more. Return `name`, `price`, `band`.
---solution
SELECT name, price,
  CASE WHEN price < 20 THEN 'budget'
       WHEN price < 100 THEN 'mid'
       ELSE 'premium' END AS band
FROM products;
:::

:::exercise
id: fn-coalesce-city
level: 2
title: Fill in the blanks
---
Return `first_name` and `location` for every employee, where `location` is their city, or `Remote` when the city is missing.
---solution
SELECT first_name, COALESCE(city, 'Remote') AS location FROM employees;
:::

:::exercise
id: fn-tenure
level: 3
title: Years of service
---
For each employee return `first_name`, `hire_date`, and `years`: whole years between the hire date and **2026-01-01**, rounded **down**. (Divide the day difference by 365.25.)
---hint
`JULIANDAY('2026-01-01') - JULIANDAY(hire_date)` gives days.
---hint
`CAST(x AS INTEGER)` truncates toward zero.
---solution
SELECT first_name, hire_date,
       CAST((JULIANDAY('2026-01-01') - JULIANDAY(hire_date)) / 365.25 AS INTEGER) AS years
FROM employees;
:::

:::exercise
id: fn-custom-sort
level: 3
title: Status triage
ordered: true
---
List `order_id` and `status` for all orders, sorted so that `pending` comes first, then `shipped`, then `cancelled`, then `delivered`. Within a status, sort by `order_id`.
---hint
Map each status to a number with CASE inside ORDER BY.
---solution
SELECT order_id, status FROM orders
ORDER BY CASE status WHEN 'pending' THEN 1 WHEN 'shipped' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END, order_id;
:::

:::exercise
id: fn-username
level: 3
title: Generate usernames
---
Build a `username` for each student: lowercase first name, a dot, lowercase last name, then the **last two digits** of their `student_id` (e.g. `liam.smith01`). Return `student_id` and `username`.
---hint
`SUBSTR(x, -2)` takes the last two characters. Cast the id to text implicitly with `||`.
---solution
SELECT student_id, LOWER(first_name) || '.' || LOWER(last_name) || SUBSTR(student_id, -2) AS username FROM students;
:::

:::exercise
id: fn-standing
level: 3
title: Academic standing
---
Classify students: `honors` (GPA 3.5 or more), `good` (2.5 up to 3.5), `probation` (below 2.5), and `unknown` when the GPA is NULL. Return `first_name`, `gpa`, `standing`.
---hint
`NULL >= 3.5` is unknown, so a NULL GPA falls through all comparisons. Where does it end up?
---solution
SELECT first_name, gpa,
  CASE WHEN gpa IS NULL THEN 'unknown'
       WHEN gpa >= 3.5 THEN 'honors'
       WHEN gpa >= 2.5 THEN 'good'
       ELSE 'probation' END AS standing
FROM students;
:::

:::exercise
id: fn-first-name-split
level: 4
title: Split full names
---
Customer names are stored as one `name` column like `Ana Silva`. Return `customer_id`, `first` and `last` as two separate columns.
---hint
Find the space with INSTR. First = before it, last = after it.
---solution
SELECT customer_id,
       SUBSTR(name, 1, INSTR(name, ' ') - 1) AS first,
       SUBSTR(name, INSTR(name, ' ') + 1) AS last
FROM customers;
:::

:::exercise
id: fn-weekday
level: 4
title: Weekend orders
---
Return `order_id`, `order_date` and the weekday name as `day` (`Saturday` or `Sunday`) for orders placed on a **weekend**.
---hint
`STRFTIME('%w', d)` gives `'0'` for Sunday … `'6'` for Saturday.
---solution
SELECT order_id, order_date,
       CASE STRFTIME('%w', order_date) WHEN '0' THEN 'Sunday' ELSE 'Saturday' END AS day
FROM orders
WHERE STRFTIME('%w', order_date) IN ('0', '6');
:::

:::exercise
id: proj-sql-04-bands
level: 2
title: "Project 4: price bands"
---
Show each product's `name`, `price`, and a column `band`: `budget` when the price is under 30, `mid-range` under 100, otherwise `premium`.
---solution
SELECT name, price, CASE WHEN price < 30 THEN 'budget' WHEN price < 100 THEN 'mid-range' ELSE 'premium' END AS band FROM products;
:::

:::exercise
id: proj-sql-04-month
level: 2
title: "Project 4b: tag orders by month"
---
List every order's `order_id`, `status`, and its month as `month` in `YYYY-MM` form (for example `2025-03`).
---hint
`strftime('%Y-%m', order_date)`
---solution
SELECT order_id, status, strftime('%Y-%m', order_date) AS month FROM orders;
:::
