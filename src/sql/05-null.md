---
id: sql-null
title: NULL & three-valued logic
summary: Why NULL isn't a value, how TRUE/FALSE/UNKNOWN combine, and the classic traps with NOT IN, COUNT and DISTINCT.
minutes: 20
---
## NULL means "unknown"

`NULL` is not zero, not an empty string, and not false. It's a marker meaning "no value here / unknown". Because the value is unknown, almost every operation involving NULL produces NULL:

```sql run
SELECT NULL + 1, NULL || 'x', NULL = NULL, NULL <> 1, 0 = '', '' IS NULL;
```

(SQLite displays `NULL = NULL` as NULL. Logically that's **UNKNOWN**.)

## Three-valued logic

SQL conditions have three outcomes: **TRUE**, **FALSE**, **UNKNOWN**. `WHERE`, `HAVING` and `ON` keep a row only if the condition is TRUE.

| AND | TRUE | FALSE | UNKNOWN |
|---|---|---|---|
| **TRUE** | TRUE | FALSE | UNKNOWN |
| **FALSE** | FALSE | FALSE | FALSE |
| **UNKNOWN** | UNKNOWN | FALSE | UNKNOWN |

| OR | TRUE | FALSE | UNKNOWN |
|---|---|---|---|
| **TRUE** | TRUE | TRUE | TRUE |
| **FALSE** | TRUE | FALSE | UNKNOWN |
| **UNKNOWN** | TRUE | UNKNOWN | UNKNOWN |

`NOT UNKNOWN` is still UNKNOWN. The intuition: if the unknown value could flip the answer, the answer is unknown; if it couldn't (FALSE AND anything, TRUE OR anything), the answer is known.

## Trap 1: a filter and its negation don't cover every row

```sql run
SELECT
  (SELECT COUNT(*) FROM students) AS total,
  (SELECT COUNT(*) FROM students WHERE gpa >= 3.0) AS at_least_3,
  (SELECT COUNT(*) FROM students WHERE NOT (gpa >= 3.0)) AS below_3;
```

The two groups don't add up to the total: students with a NULL GPA are in neither. If you want them, say so: `WHERE gpa < 3.0 OR gpa IS NULL`.

## Trap 2: NOT IN with a NULL in the list

`x NOT IN (1, 2, NULL)` expands to `x <> 1 AND x <> 2 AND x <> NULL`. The last part is UNKNOWN, so the whole thing can never be TRUE. **The query returns nothing.**

```sql run
SELECT COUNT(*) FROM employees WHERE emp_id NOT IN (1, 2, NULL);
```

This bites hardest with subqueries. "Employees who don't manage anyone" via `NOT IN (SELECT manager_id …)` returns *zero rows*, because the CEO's `manager_id` is NULL:

```sql run
SELECT first_name FROM employees
WHERE emp_id NOT IN (SELECT manager_id FROM employees);
```

Fix it by filtering NULLs out of the subquery, or (better) use `NOT EXISTS`, which doesn't have this problem:

```sql run
SELECT first_name FROM employees
WHERE emp_id NOT IN (SELECT manager_id FROM employees WHERE manager_id IS NOT NULL);
```

> [!exam] Must-know
> `NOT IN` + a subquery that can return NULL = empty result. This shows up on exams and in production bugs alike.

## Trap 3: aggregates skip NULLs

`COUNT(*)` counts rows. `COUNT(col)` counts **non-NULL** values in `col`. `SUM`, `AVG`, `MIN`, `MAX` all ignore NULLs.

```sql run
SELECT COUNT(*) AS rows_, COUNT(gpa) AS with_gpa, COUNT(major) AS with_major,
       AVG(gpa) AS avg_known, SUM(gpa) / COUNT(*) AS avg_treating_null_as_0
FROM students;
```

`AVG(gpa)` averages only the known GPAs. Whether that's "right" depends on what you mean; just know which one you're computing. `SUM` over zero non-NULL rows is NULL, not 0 (use `TOTAL()` in SQLite or `COALESCE(SUM(x), 0)`).

## Trap 4: DISTINCT, GROUP BY and UNION treat NULLs as equal

Even though `NULL = NULL` is unknown, grouping operations lump all NULLs together into one group:

```sql run
SELECT major, COUNT(*) FROM students GROUP BY major;
```

## Tools for working with NULL

| Tool | Use |
|---|---|
| `IS NULL`, `IS NOT NULL` | test for NULL |
| `COALESCE(a, b, …)` | first non-NULL value (defaults) |
| `NULLIF(a, b)` | NULL when a = b |
| `a IS b` / `a IS NOT b` | NULL-safe equality in SQLite (`IS DISTINCT FROM` in standard SQL) |
| `NULLS FIRST/LAST` | control sort position |

```sql run
SELECT NULL IS NULL, 1 IS 1, NULL IS 1, 1 IS NOT NULL;
```

:::quiz
q: `TRUE OR UNKNOWN` evaluates to…
+ TRUE
- FALSE
- UNKNOWN
- an error
why: Whatever the unknown value is, TRUE OR it is TRUE.
:::

:::quiz
q: `FALSE AND UNKNOWN` evaluates to…
- TRUE
+ FALSE
- UNKNOWN
- NULL
why: FALSE AND anything is FALSE.
:::

:::quiz
q: A table has 10 rows; 3 have NULL in column c. What is `COUNT(c)`?
- 10
+ 7
- 3
- NULL
why: COUNT(column) counts non-NULL values. COUNT(*) would be 10.
:::

:::quiz
q: `WHERE id NOT IN (SELECT ref FROM t)` returns no rows at all. The most likely cause is…
- t is empty
+ some `ref` value is NULL
- id is the primary key
- NOT IN isn't supported
why: One NULL in the list makes every NOT IN comparison UNKNOWN. If t were empty, NOT IN would return every row.
:::

:::quiz
q: Which correctly finds rows where x differs from y, counting NULL vs non-NULL as different?
- `WHERE x <> y`
+ `WHERE x IS NOT y`
- `WHERE NOT x = y`
- `WHERE x != y OR x = NULL`
why: `<>` is UNKNOWN when either side is NULL. SQLite's IS NOT (standard: IS DISTINCT FROM) is NULL-safe.
:::

:::exercise
id: nul-no-gpa
level: 1
title: GPA not on file
---
Return `first_name` and `last_name` of students whose GPA is unknown.
---solution
SELECT first_name, last_name FROM students WHERE gpa IS NULL;
:::

:::exercise
id: nul-count-variants
level: 1
title: Three ways to count
---
In one row, return: `total` = number of employees, `with_email` = how many have an email, `with_city` = how many have a city.
---solution
SELECT COUNT(*) AS total, COUNT(email) AS with_email, COUNT(city) AS with_city FROM employees;
:::

:::exercise
id: nul-below-or-null
level: 2
title: Needs advising
---
Advisors want every student who does **not** have a GPA of at least 3.0. That includes students with **no GPA**. Return `first_name` and `gpa`.
---hint
`NOT (gpa >= 3.0)` silently skips NULLs.
---solution
SELECT first_name, gpa FROM students WHERE gpa < 3.0 OR gpa IS NULL;
:::

:::exercise
id: nul-in-progress
level: 2
title: Courses still in progress
---
Enrollments without a grade are in progress. Return `student_id`, `course_id` and `term` for every enrollment with no `grade`.
---solution
SELECT student_id, course_id, term FROM enrollments WHERE grade IS NULL;
:::

:::exercise
id: nul-coalesce-label
level: 2
title: Undeclared majors
---
Return each student's `first_name` and `major`, showing `Undeclared` when the major is missing.
---solution
SELECT first_name, COALESCE(major, 'Undeclared') AS major FROM students;
:::

:::exercise
id: nul-not-managers
level: 3
title: Individual contributors
---
List the `first_name` of every employee who manages **nobody**. Use `NOT IN` with a subquery, and make it work despite the NULL `manager_id`.
---hint
Remove NULLs from the subquery's output.
---solution
SELECT first_name FROM employees
WHERE emp_id NOT IN (SELECT manager_id FROM employees WHERE manager_id IS NOT NULL);
:::

:::exercise
id: nul-avg-two-ways
level: 3
title: Two averages
---
Return two columns: `avg_known` = average GPA over students who have one, and `avg_zero` = average GPA if missing GPAs counted as 0. Round both to 3 decimals.
---hint
`AVG(COALESCE(gpa, 0))` treats NULL as 0.
---solution
SELECT ROUND(AVG(gpa), 3) AS avg_known, ROUND(AVG(COALESCE(gpa, 0)), 3) AS avg_zero FROM students;
:::

:::exercise
id: nul-safe-compare
level: 3
title: Contact info mismatch
---
Find employees whose `city` is **not** `'Raleigh'`, treating a missing city as "not Raleigh". Return `first_name` and `city`.
---hint
`city <> 'Raleigh'` drops NULL cities. Try `IS NOT`, or an OR.
---solution
SELECT first_name, city FROM employees WHERE city IS NOT 'Raleigh';
:::

:::exercise
id: nul-truth
level: 4
title: Truth table in SQL
---
Without any table, return one row with these columns, letting SQLite compute each value (don't type the answers): `a` = `NULL AND 0`, `b` = `NULL OR 1`, `c` = `NULL AND 1`, `d` = `NOT NULL`, `e` = `NULL IS NULL`.
---explain
`NULL AND 0` is 0 (false), `NULL OR 1` is 1 (true), `NULL AND 1` is NULL (unknown), `NOT NULL` is NULL, and `NULL IS NULL` is 1.
---solution
SELECT NULL AND 0 AS a, NULL OR 1 AS b, NULL AND 1 AS c, NOT NULL AS d, NULL IS NULL AS e;
:::
