## Query skeleton and evaluation order

```sql
SELECT [DISTINCT] cols, expr AS alias, AGG(col)
FROM t1 [AS a]
  [INNER | LEFT | RIGHT | FULL | CROSS] JOIN t2 b ON a.k = b.k
WHERE row_condition
GROUP BY cols
HAVING group_condition
ORDER BY col [ASC | DESC] [NULLS FIRST | LAST], …
LIMIT n OFFSET k;
```

| Order | Clause | Can see aggregates? | Can use SELECT aliases? |
|---|---|---|---|
| 1 | FROM / JOIN | no | no |
| 2 | WHERE | **no** | no (standard SQL) |
| 3 | GROUP BY | no | SQLite/MySQL/Postgres: yes |
| 4 | HAVING | **yes** | some databases |
| 5 | SELECT, window functions | yes | n/a |
| 6 | DISTINCT | | |
| 7 | ORDER BY | yes | **yes** |
| 8 | LIMIT / OFFSET | | |

## Filtering

| Need | Write |
|---|---|
| equal / not equal | `=`, `<>` (or `!=`) |
| in a list | `col IN ('a', 'b')` |
| inclusive range | `col BETWEEN 10 AND 20` |
| pattern | `LIKE 'A%'` (`%` any run, `_` one char) |
| missing | `col IS NULL` / `IS NOT NULL` (never `= NULL`) |
| precedence | `NOT` > `AND` > `OR`; parenthesize mixes |
| half-open date range | `d >= '2025-04-01' AND d < '2025-07-01'` |

## NULL rules

- Any comparison with NULL is UNKNOWN; WHERE keeps only TRUE.
- `COUNT(*)` counts rows; `COUNT(col)` and every other aggregate skip NULLs.
- `NOT IN (subquery)` returns **nothing** if the subquery yields a NULL. Use `NOT EXISTS`.
- GROUP BY, DISTINCT, UNION treat NULLs as equal.
- `COALESCE(a, b, …)` first non-NULL; `NULLIF(a, b)` NULL when equal; `a IS b` NULL-safe equality (SQLite).

## Functions (SQLite names)

| Kind | Functions |
|---|---|
| string | `UPPER LOWER LENGTH SUBSTR(s, start, len) INSTR(s, x) REPLACE TRIM`, concat `\|\|` |
| number | `ROUND(x, d) ABS CAST(x AS INTEGER)`, `x % y`, `7 / 2 = 3` (integer division!) |
| date | `DATE(d, '+1 month') STRFTIME('%Y-%m', d) JULIANDAY(b) - JULIANDAY(a)` |
| logic | `CASE WHEN … THEN … ELSE … END`, `IIF(c, a, b)`, `COALESCE`, `NULLIF` |
| aggregate | `COUNT SUM AVG MIN MAX GROUP_CONCAT(x, ', ')`, `COUNT(DISTINCT x)` |

## Joins at a glance

| Join | Keeps |
|---|---|
| `A JOIN B ON …` | matching pairs only |
| `A LEFT JOIN B ON …` | all of A; B columns NULL when no match |
| `A FULL JOIN B ON …` | everything from both |
| `A CROSS JOIN B` | every combination |
| self-join | `FROM employees e JOIN employees m ON m.emp_id = e.manager_id` |

Anti-join ("A without B"):

```sql
SELECT a.* FROM a LEFT JOIN b ON b.a_id = a.id WHERE b.a_id IS NULL;
SELECT a.* FROM a WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id);
```

Outer-join rule: filters on the right table go in **ON**, not WHERE.

## Subqueries and CTEs

```sql
WHERE x > (SELECT AVG(x) FROM t)                         -- scalar
WHERE id IN (SELECT id FROM t WHERE …)                    -- list
WHERE EXISTS (SELECT 1 FROM t WHERE t.k = outer.k)        -- correlated
FROM (SELECT … GROUP BY …) AS sub                          -- derived table

WITH step1 AS (…), step2 AS (SELECT … FROM step1)
SELECT … FROM step2;

WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 10)
SELECT n FROM r;
```

## Window functions

```sql
fn() OVER (PARTITION BY g ORDER BY o ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
```

| Function | Use |
|---|---|
| `ROW_NUMBER()` | unique sequence; top-N per group |
| `RANK()` / `DENSE_RANK()` | ties share a rank (with / without gaps) |
| `NTILE(n)` | buckets |
| `SUM(x) OVER (ORDER BY d)` | running total |
| `AVG(x) OVER (… ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)` | moving average |
| `LAG(x, 1, default)` / `LEAD` | previous / next row |
| `FIRST_VALUE(x)` | first in window |

Filter on a window result in an outer query/CTE, never in WHERE.

## Set operations

`UNION` (dedup) · `UNION ALL` (keep dups) · `INTERSECT` · `EXCEPT`. Same column count; names from the first query; one ORDER BY at the end.

## Changing data

```sql
INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y');
INSERT INTO t (a, b) SELECT … ;
UPDATE t SET a = a + 1 WHERE …;          -- no WHERE = every row!
DELETE FROM t WHERE …;
INSERT … ON CONFLICT (id) DO UPDATE SET qty = excluded.qty;   -- upsert
BEGIN; … COMMIT;   /   ROLLBACK;
```

## Defining data

```sql
CREATE TABLE t (
  id     INTEGER PRIMARY KEY,
  email  TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  dept   INTEGER REFERENCES departments(dept_id) ON DELETE CASCADE
);
ALTER TABLE t ADD COLUMN note TEXT;
CREATE INDEX idx_t_dept ON t(dept);
CREATE VIEW v AS SELECT …;
DROP TABLE IF EXISTS t;
```

## Normal forms

| Form | Rule | Typical violation |
|---|---|---|
| 1NF | atomic values, no repeating groups | `phones = '555-1, 555-2'` |
| 2NF | no partial dependency on part of a composite key | `(student, course) → student_name` |
| 3NF | no transitive dependency through a non-key | `emp → dept → dept_name` |
| BCNF | every determinant is a superkey | overlapping candidate keys |

"The key, the whole key, and nothing but the key."

## Pattern cookbook

| Question shape | Pattern |
|---|---|
| top N per group | `ROW_NUMBER() OVER (PARTITION BY g ORDER BY x DESC)` then `rn <= N` |
| "never", "without" | anti-join |
| "every", "all" | relational division: double NOT EXISTS, or count = total |
| pivot | `SUM(CASE WHEN cat = 'x' THEN v ELSE 0 END)` |
| change vs previous | `LAG()` |
| consecutive runs | `value - ROW_NUMBER()` groups (gaps & islands) |
| include zero rows | LEFT JOIN from a complete list (calendar via recursive CTE) |
| count without fan-out | `COUNT(DISTINCT parent.id)`, or aggregate before joining |
