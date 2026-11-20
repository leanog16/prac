---
id: sql-design
title: Keys & normalization
summary: Candidate, primary, foreign, natural and surrogate keys; one-to-many and many-to-many relationships; functional dependencies; 1NF, 2NF, 3NF and BCNF; when to denormalize.
minutes: 35
---
> [!project] Taskboard, step 15: why the tables look the way they do
> Before Taskboard existed, its team tracked work in one shared spreadsheet: a row per task with the board name, the assignee's name and email, and the labels typed into one cell. In this lesson you'll see why that became six tables, and decide where new facts belong.

## Why design matters

A badly designed table works fine on day one and then quietly corrupts itself. Consider a single "everything" table:

| order_id | customer | customer_email | product | price | qty |
|---|---|---|---|---|---|
| 1 | Ana Silva | ana@silva.example | Wireless Mouse | 24.99 | 2 |
| 1 | Ana Silva | ana@silva.example | Desk Lamp | 32.00 | 1 |
| 2 | Ana Silva | ana@silva.example | Desk Lamp | 32.00 | 3 |
| 3 | Ben Ford | ben@ford.example | Webcam HD | 59.00 | 1 |

It suffers from the three classic **anomalies**:

- **Update anomaly**: Ana changes her email. You must update it in every one of her rows; miss one and the data contradicts itself.
- **Insertion anomaly**: you can't record a new product until someone orders it (there's no row to put it in).
- **Deletion anomaly**: delete order 3 and you lose the fact that Ben exists at all.

The cure is **normalization**: split tables so each fact is stored exactly once.

## Keys

| Term | Meaning | Example |
|---|---|---|
| **superkey** | any set of columns that uniquely identifies a row | `{emp_id, last_name}` |
| **candidate key** | a *minimal* superkey (remove any column and it stops being unique) | `{emp_id}`, `{email}` |
| **primary key** | the candidate key you choose as the main identifier | `emp_id` |
| **alternate key** | a candidate key you didn't choose (enforce with UNIQUE) | `email` |
| **foreign key** | a column referencing another table's key | `employees.dept_id` |
| **composite key** | a key made of several columns | `(student_id, course_id, term)` |
| **natural key** | a key with real-world meaning | ISBN, SSN, course code |
| **surrogate key** | a meaningless generated id | auto-increment `emp_id` |

Surrogate keys are stable (names and emails change; `emp_id` 17 never does) and compact. Natural keys still deserve a `UNIQUE` constraint so duplicates can't sneak in.

## Relationships

| Cardinality | How to model | Example |
|---|---|---|
| one-to-one | FK with UNIQUE (or shared PK) | employee ↔ parking spot |
| one-to-many | FK on the **many** side | department → employees (`employees.dept_id`) |
| many-to-many | **junction table** with two FKs | students ↔ courses via `enrollments` |

The junction table often carries facts about the relationship itself: `enrollments` holds `term` and `grade`, which belong to neither the student nor the course alone.

```sql run
-- the many-to-many in action: courses per student and students per course both come from the junction table
SELECT s.first_name, COUNT(*) AS courses
FROM students s JOIN enrollments e ON e.student_id = s.student_id
GROUP BY s.student_id ORDER BY courses DESC LIMIT 5;
```

## Functional dependencies

A **functional dependency** `X → Y` means: knowing X determines Y. In the "everything" table:

- `customer_email → customer` (an email belongs to one customer)
- `product → price`
- `{order_id, product} → qty`

Normal forms are rules about which dependencies a table may contain.

## The normal forms

### First normal form (1NF)

Every column holds a single, atomic value; no repeating groups. Violations: a `phones` column containing `"919-555-0100, 919-555-0199"`, or columns `phone1, phone2, phone3`. Fix: one row per value in a separate table.

### Second normal form (2NF)

1NF, and no non-key column depends on **part** of a composite key. In a table keyed by `(order_id, product)`, `price` depends only on `product`: a *partial dependency*. Fix: move `price` to a `products` table keyed by product.

### Third normal form (3NF)

2NF, and no non-key column depends on **another non-key column** (no *transitive* dependency). If `employees` stored `dept_id` and `dept_name`, then `emp_id → dept_id → dept_name`. Fix: `dept_name` lives in `departments`.

> [!tip] The mnemonic
> Every non-key attribute must depend on **the key** (1NF), **the whole key** (2NF), and **nothing but the key** (3NF), "so help me Codd".

### Boyce–Codd normal form (BCNF)

Stricter than 3NF: for every non-trivial dependency `X → Y`, X must be a superkey. Rarely differs from 3NF in practice; the classic exception involves overlapping composite candidate keys (e.g. each instructor teaches exactly one subject, and students take each subject from one instructor: `{student, subject} → instructor` and `instructor → subject`).

## Normalizing the example

| Table | Key | Facts |
|---|---|---|
| customers | customer_id | name, email |
| products | product_id | name, price |
| orders | order_id | customer_id, order_date |
| order_items | (order_id, product_id) | qty, unit_price |

That's exactly the store schema you've been querying. Note that `order_items.unit_price` *looks* like duplication of `products.price`, but it isn't: it records the price **at the time of sale**, a different fact from the current list price.

## Denormalization

Normalized schemas are best for writes and integrity. Read-heavy systems (reporting, analytics) sometimes deliberately **denormalize** (store a precomputed total, copy a name into a log table) to avoid expensive joins. That's a trade-off you make on purpose, with a plan to keep copies in sync, not an accident.

> [!plain] In plain English
> Normalization puts each fact in the table about the thing it describes; joins put the facts back together for reports.

:::quiz
q: A table keyed by `(student_id, course_id)` has a column `student_name`. Which normal form does it violate?
- 1NF
+ 2NF
- 3NF only
- none
why: student_name depends on only part of the composite key (student_id): a partial dependency.
:::

:::quiz
q: `employees(emp_id PK, dept_id, dept_building)` where each department is in one building. What's wrong?
- partial dependency, violates 2NF
+ transitive dependency emp_id → dept_id → dept_building, violates 3NF
- repeating group, violates 1NF
- nothing
why: dept_building depends on a non-key column. Move it to departments.
:::

:::quiz
q: How do you model a many-to-many relationship between students and clubs?
- a club_id column in students
- a student_id column in clubs
+ a junction table with student_id and club_id
- a comma-separated list of club ids in students
why: Neither side can hold a single FK; the pairs go in their own table (and a list column would violate 1NF).
:::

:::quiz
q: Which is a candidate key of `employees`?
+ `{email}` (unique and minimal)
- `{emp_id, email}`
- `{first_name}`
- `{dept_id}`
why: {emp_id, email} is a superkey but not minimal. first_name and dept_id aren't unique.
:::

:::quiz
q: Deleting the last order of a customer also deletes the only record that the customer exists. This is a…
- update anomaly
- insertion anomaly
+ deletion anomaly
- referential anomaly
why: Facts about different things were stored in one row, so deleting one fact destroyed another.
:::

:::quiz
q: Why is `order_items.unit_price` not a normalization violation even though products has a price?
- It is a violation; it should be removed
+ It records a different fact: the price at the time of sale
- Because it's a REAL column
- Because order_items has a composite key
why: List prices change; historical sale prices must not.
:::

:::exercise
id: des-decompose
level: 3
title: Normalize a flat roster
---
Run this setup at the start of your answer. It creates a denormalized table:

```sql
CREATE TABLE roster (student_id INTEGER, student_name TEXT, course_code TEXT, course_title TEXT, grade TEXT);
INSERT INTO roster VALUES
 (1, 'Ana', 'CSC 116', 'Intro to Java', 'A'),
 (1, 'Ana', 'MA 141',  'Calculus I',    'B'),
 (2, 'Bo',  'CSC 116', 'Intro to Java', 'B+'),
 (3, 'Cy',  'MA 141',  'Calculus I',    'A-'),
 (3, 'Cy',  'CSC 216', 'Software Dev',  NULL);
```

Then create and fill three normalized tables: `r_students(student_id PRIMARY KEY, name)`, `r_courses(code PRIMARY KEY, title)`, and `r_grades(student_id, code, grade)` with primary key `(student_id, code)`. Populate them from `roster` with `INSERT … SELECT DISTINCT`.
---check
SELECT 'students', COUNT(*) FROM r_students
UNION ALL SELECT 'courses', COUNT(*) FROM r_courses
UNION ALL SELECT 'grades', COUNT(*) FROM r_grades
UNION ALL SELECT 'roundtrip', COUNT(*) FROM r_grades g JOIN r_students s USING (student_id) JOIN r_courses c USING (code);
---solution
CREATE TABLE roster (student_id INTEGER, student_name TEXT, course_code TEXT, course_title TEXT, grade TEXT);
INSERT INTO roster VALUES
 (1, 'Ana', 'CSC 116', 'Intro to Java', 'A'),
 (1, 'Ana', 'MA 141',  'Calculus I',    'B'),
 (2, 'Bo',  'CSC 116', 'Intro to Java', 'B+'),
 (3, 'Cy',  'MA 141',  'Calculus I',    'A-'),
 (3, 'Cy',  'CSC 216', 'Software Dev',  NULL);
CREATE TABLE r_students (student_id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE r_courses (code TEXT PRIMARY KEY, title TEXT);
CREATE TABLE r_grades (student_id INTEGER REFERENCES r_students(student_id), code TEXT REFERENCES r_courses(code), grade TEXT, PRIMARY KEY (student_id, code));
INSERT INTO r_students SELECT DISTINCT student_id, student_name FROM roster;
INSERT INTO r_courses SELECT DISTINCT course_code, course_title FROM roster;
INSERT INTO r_grades SELECT student_id, course_code, grade FROM roster;
:::

:::exercise
id: des-candidate-check
level: 2
title: Is it a candidate key?
---
A column set is a usable key only if it's unique across the table. Write one query returning two columns: `email_unique` = 1 if `customers.email` values (ignoring NULLs) are all distinct, else 0; and `city_unique` = the same test for `city`.
---hint
Compare `COUNT(col)` with `COUNT(DISTINCT col)`.
---solution
SELECT (COUNT(email) = COUNT(DISTINCT email)) AS email_unique, (COUNT(city) = COUNT(DISTINCT city)) AS city_unique FROM customers;
:::

:::exercise
id: des-fd-violation
level: 3
title: Detect a broken dependency
---
In `order_items`, the dependency `product_id → unit_price` does **not** hold (the same product sold at different prices). Prove it: return each `product_id` that has **more than one distinct** `unit_price`, with `prices` = how many distinct prices.
---solution
SELECT product_id, COUNT(DISTINCT unit_price) AS prices FROM order_items GROUP BY product_id HAVING COUNT(DISTINCT unit_price) > 1;
:::

:::exercise
id: des-1nf
level: 4
title: Fix a 1NF violation
---
Run this setup first. `skills` packs several values into one column:

```sql
CREATE TABLE devs (dev_id INTEGER PRIMARY KEY, name TEXT, skills TEXT);
INSERT INTO devs VALUES (1, 'Ana', 'sql,python'), (2, 'Bo', 'bash'), (3, 'Cy', 'sql,bash,go');
```

Create `dev_skills(dev_id, skill)` with one row per developer per skill, and fill it **using a query** (a recursive CTE that peels off one comma-separated item per step), not by typing the rows.
---hint
Recursive state: `(dev_id, skill, rest)`. Anchor: `rest = skills || ','` and an empty skill. Step: skill = text before the first comma of rest, rest = text after it. Stop when rest is empty.
---check
SELECT dev_id, skill FROM dev_skills ORDER BY dev_id, skill;
---solution
CREATE TABLE devs (dev_id INTEGER PRIMARY KEY, name TEXT, skills TEXT);
INSERT INTO devs VALUES (1, 'Ana', 'sql,python'), (2, 'Bo', 'bash'), (3, 'Cy', 'sql,bash,go');
CREATE TABLE dev_skills (dev_id INTEGER, skill TEXT, PRIMARY KEY (dev_id, skill));
INSERT INTO dev_skills
WITH RECURSIVE split(dev_id, skill, rest) AS (
  SELECT dev_id, '', skills || ',' FROM devs
  UNION ALL
  SELECT dev_id, SUBSTR(rest, 1, INSTR(rest, ',') - 1), SUBSTR(rest, INSTR(rest, ',') + 1)
  FROM split WHERE rest <> ''
)
SELECT dev_id, skill FROM split WHERE skill <> '';
:::

:::exercise
id: des-junction-query
level: 2
title: Through the junction
---
The `enrollments` table is a junction between students and courses. Return each course `code` and the number of **distinct students** who have ever taken it as `students`, including courses nobody took (0).
---solution
SELECT c.code, COUNT(DISTINCT e.student_id) AS students FROM courses c LEFT JOIN enrollments e ON e.course_id = c.course_id GROUP BY c.course_id, c.code;
:::

:::exercise
id: proj-sql-15-which-table
level: 2
title: "Project 15: where does it belong?"
mode: answer
---
Taskboard wants to record each member's **time zone**, so due-date reminders arrive in the morning. Which Taskboard table should the new column go in?
---answer
members
---solution
members
---explain
A time zone describes one person, and `members` has exactly one row per person.
:::

:::exercise
id: proj-sql-15-gift-wrap
level: 3
title: "Project 15b: a fact about two things"
mode: answer
---
Labels can now be added automatically (by a rule) or by hand, and the team wants to record which. Whether a label was added automatically depends on the task **and** the label together. Which table should an `added_by_rule` column go in?
---answer
task_labels
---solution
task_labels
---explain
`task_labels` is the junction table with one row per task per label: exactly the grain of this fact, like `grade` in `enrollments`.
:::

:::exercise
id: proj-sql-15-anomaly
level: 2
title: "Project 15c: name the anomaly"
mode: answer
---
In the old one-big-spreadsheet design, the team couldn't record a new board until someone created a task on it. What kind of anomaly is that: **insert**, **update** or **delete**?
---answer
insert
---answer
insert anomaly
---solution
insert
:::
