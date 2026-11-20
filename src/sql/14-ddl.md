---
id: sql-ddl
title: Tables, constraints & indexes
summary: CREATE TABLE with types and constraints (PRIMARY KEY, NOT NULL, UNIQUE, CHECK, DEFAULT, FOREIGN KEY), ALTER and DROP, indexes and when they help, and views.
minutes: 35
---
> [!project] Taskboard, step 14: time tracking
> The team wants to log time against tasks. That's a new table, and getting its constraints right means bad data can't get in, no matter which app writes to it. You'll also save the open-task query as a view the whole report can reuse.

## Data Definition Language

**DDL** statements define structure: `CREATE`, `ALTER`, `DROP`. Constraints are rules the database enforces on every insert and update, so bad data can't get in no matter which program writes it.

```sql run
CREATE TABLE pets (
  pet_id     INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  species    TEXT    NOT NULL CHECK (species IN ('dog', 'cat', 'bird', 'fish')),
  birth_date TEXT,
  adopted    INTEGER NOT NULL DEFAULT 0,
  chip_id    TEXT    UNIQUE,
  owner_id   INTEGER REFERENCES customers(customer_id)
);

INSERT INTO pets (name, species, chip_id, owner_id) VALUES ('Biscuit', 'dog', 'A-100', 1);
SELECT * FROM pets;
```

## Types

| Standard type | Use | SQLite affinity |
|---|---|---|
| `INTEGER`, `BIGINT`, `SMALLINT` | whole numbers | INTEGER |
| `DECIMAL(p, s)` / `NUMERIC` | exact money amounts | NUMERIC |
| `REAL`, `FLOAT`, `DOUBLE` | approximate numbers | REAL |
| `VARCHAR(n)`, `CHAR(n)`, `TEXT` | strings | TEXT |
| `DATE`, `TIMESTAMP` | dates and times | (stored as TEXT or numbers) |
| `BOOLEAN` | true/false | INTEGER 0/1 |

SQLite is permissive: it records a type *affinity* but will store, say, text in an INTEGER column unless the table is declared `STRICT`. PostgreSQL and others reject mismatched types. For exams, write standard types.

> [!tip] Money
> Never use floating point for money (0.1 + 0.2 ≠ 0.3 in binary). Use an exact decimal type where the database enforces it, or store integer cents. SQLite gives `DECIMAL(10, 2)` NUMERIC affinity, not fixed decimal precision, so integer cents are safer there.

## Constraints

| Constraint | Guarantees |
|---|---|
| `PRIMARY KEY` | unique and (in standard SQL) not null; identifies the row; one per table (may span several columns) |
| `NOT NULL` | a value is required |
| `UNIQUE` | no two rows share the value (NULLs are allowed, and usually several NULLs are allowed) |
| `CHECK (expr)` | expr must not be false for any row |
| `DEFAULT value` | used when the insert omits the column |
| `FOREIGN KEY … REFERENCES t(col)` | the value must exist in t.col (or be NULL) |

Watch them reject bad rows:

```sql run
CREATE TABLE accounts (
  id      INTEGER PRIMARY KEY,
  email   TEXT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0)
);
INSERT INTO accounts (email) VALUES ('a@x.example');
-- each of these fails a constraint; OR IGNORE skips the bad row instead of erroring
INSERT OR IGNORE INTO accounts (email, balance) VALUES ('b@x.example', -5);
INSERT OR IGNORE INTO accounts (email) VALUES ('a@x.example');
INSERT OR IGNORE INTO accounts (email) VALUES (NULL);
SELECT * FROM accounts;
```

Remove `OR IGNORE` in the playground to see the actual error messages.

### Table-level constraints

Constraints that involve several columns are written after the column list, optionally with a name:

```sql
CREATE TABLE enrollments_v2 (
  student_id INTEGER NOT NULL,
  course_id  INTEGER NOT NULL,
  term       TEXT    NOT NULL,
  grade      TEXT,
  PRIMARY KEY (student_id, course_id, term),
  CONSTRAINT fk_student FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
  CONSTRAINT valid_grade CHECK (grade IS NULL OR grade IN ('A','A-','B+','B','B-','C+','C','C-','D','F'))
);
```

### Foreign key actions

What happens to child rows when the parent row is deleted or its key changes?

| Action | Effect on children |
|---|---|
| `NO ACTION` / `RESTRICT` (default) | the delete/update is refused |
| `CASCADE` | children are deleted/updated too |
| `SET NULL` | the child's FK becomes NULL |
| `SET DEFAULT` | the child's FK becomes its default |

> [!warn] SQLite needs FKs switched on
> For backward compatibility SQLite ignores foreign keys unless you run `PRAGMA foreign_keys = ON;` per connection. Every other major database enforces them by default.

```sql run
PRAGMA foreign_keys = ON;
CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT, team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE);
INSERT INTO teams VALUES (1, 'Wolves'), (2, 'Owls');
INSERT INTO players VALUES (1, 'Ana', 1), (2, 'Bo', 1), (3, 'Cy', 2);
DELETE FROM teams WHERE id = 1;
SELECT * FROM players;
```

## ALTER and DROP

```sql
ALTER TABLE pets ADD COLUMN weight_kg REAL;
ALTER TABLE pets RENAME COLUMN chip_id TO microchip;
ALTER TABLE pets RENAME TO animals;
ALTER TABLE animals DROP COLUMN weight_kg;   -- SQLite 3.35+
DROP TABLE IF EXISTS animals;
```

SQLite's ALTER is limited (you can't add a constraint to an existing column); the standard workaround is create-new-table, copy, drop, rename. PostgreSQL supports `ALTER TABLE … ADD CONSTRAINT`, `ALTER COLUMN … SET NOT NULL`, and more.

`CREATE TABLE new AS SELECT …` makes a table from a query (no constraints are copied).

## Indexes

An **index** is a separate sorted structure (usually a B-tree) that lets the database find rows by a column's value without scanning the whole table: O(log n) lookups instead of O(n).

```sql run
CREATE INDEX idx_orders_customer ON orders(customer_id);
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = 7;
```

- Primary keys and UNIQUE columns are indexed automatically.
- Index columns you **filter**, **join** and **sort** on frequently, especially foreign keys.
- A composite index on `(a, b)` helps queries filtering on `a`, or on `a` and `b`, but not `b` alone (the "leftmost prefix" rule).
- Indexes cost disk space and slow down INSERT/UPDATE/DELETE, since every index must be maintained. Don't index everything.
- `CREATE UNIQUE INDEX` doubles as a uniqueness constraint.

## Views

A **view** is a saved query that behaves like a read-only table. It stores no data; it runs its query each time.

```sql run
CREATE VIEW dept_payroll AS
SELECT d.name AS department, COUNT(e.emp_id) AS headcount, COALESCE(SUM(e.salary), 0) AS payroll
FROM departments d LEFT JOIN employees e ON e.dept_id = d.dept_id
GROUP BY d.dept_id;

SELECT * FROM dept_payroll WHERE headcount > 2;
```

Views simplify repeated queries, hide complexity, and can restrict which columns a user sees.

## Worked example: designing a table from requirements

Requirements: "A customer can review a product once, with a rating from 1 to 5 and an optional comment. We need to know when it was written."

Translate each sentence into a constraint:

| Requirement | Constraint |
|---|---|
| a review belongs to a real customer and product | `REFERENCES customers`, `REFERENCES products` |
| once per customer per product | `UNIQUE (customer_id, product_id)` |
| rating 1–5, required | `NOT NULL CHECK (rating BETWEEN 1 AND 5)` |
| optional comment | nullable `TEXT` |
| when it was written | `NOT NULL DEFAULT (date('now'))` |

```sql
CREATE TABLE reviews (
  review_id   INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  product_id  INTEGER NOT NULL REFERENCES products(product_id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_on  TEXT NOT NULL DEFAULT (date('now')),
  UNIQUE (customer_id, product_id)
);
CREATE INDEX idx_reviews_product ON reviews(product_id);
```

The index on `product_id` makes "show all reviews for this product" fast. Every product page will run that query.

> [!plain] In plain English
> Constraints are rules the **database** enforces. Application code has bugs and there's often more than one app; a `CHECK` constraint can't be forgotten.

## Common mistakes

> [!mistake] Foreign keys that aren't enforced
> SQLite only enforces `REFERENCES` after `PRAGMA foreign_keys = ON;`, per connection. PostgreSQL and MySQL (InnoDB) always enforce them.

> [!mistake] Storing money as floating point
> `REAL` can't represent 0.1 exactly, so sums drift by fractions of a cent. Use an exact decimal type in databases that support it, or integer **cents** in SQLite.

:::quiz
q: A column is declared `UNIQUE` but not `NOT NULL`. Can two rows have NULL there?
+ Yes, in most databases (NULLs aren't considered equal to each other)
- No, UNIQUE forbids duplicates including NULL
- Only one NULL is allowed everywhere
- UNIQUE columns can't hold NULL at all
why: SQLite, PostgreSQL, MySQL and Oracle allow multiple NULLs in a UNIQUE column. SQL Server allows only one.
:::

:::quiz
q: The parent row of a FOREIGN KEY with `ON DELETE CASCADE` is deleted. What happens to the child rows?
- They're kept with the same key
- Their FK becomes NULL
+ They're deleted too
- The delete is refused
why: CASCADE propagates the delete. SET NULL would null the FK; RESTRICT/NO ACTION would refuse.
:::

:::quiz
q: A composite index on `(last_name, first_name)` helps which query most?
+ `WHERE last_name = 'Kim'`
- `WHERE first_name = 'Jade'`
- `WHERE salary > 100000`
- `ORDER BY first_name`
why: Composite indexes serve their leftmost prefix. first_name alone can't use it efficiently.
:::

:::quiz
q: What's a downside of adding many indexes?
- SELECTs get slower
+ INSERT, UPDATE and DELETE get slower and storage grows
- Primary keys stop working
- Views break
why: Every write has to update every index on the table.
:::

:::quiz
q: A view…
- stores a copy of the data at creation time
+ stores a query that runs each time the view is used
- can only reference one table
- is the same as a temporary table
why: A regular view is a named query. (Materialized views, in PostgreSQL and others, do store results.)
:::

:::exercise
id: ddl-create-books
level: 1
title: A books table
---
Create a table `books` with columns: `book_id` INTEGER PRIMARY KEY, `title` TEXT NOT NULL, `author` TEXT NOT NULL, `year` INTEGER, `isbn` TEXT UNIQUE.
---check
SELECT name, type, "notnull", pk FROM pragma_table_info('books') ORDER BY cid;
---solution
CREATE TABLE books (
  book_id INTEGER PRIMARY KEY,
  title   TEXT NOT NULL,
  author  TEXT NOT NULL,
  year    INTEGER,
  isbn    TEXT UNIQUE
);
:::

:::exercise
id: ddl-add-column
level: 1
title: Add a phone column
---
Add a `phone` column of type TEXT to the `customers` table.
---check
SELECT name, type FROM pragma_table_info('customers') ORDER BY cid;
---solution
ALTER TABLE customers ADD COLUMN phone TEXT;
:::

:::exercise
id: ddl-view
level: 2
title: A course catalog view
---
Create a view `course_catalog` with columns `code`, `title`, `credits` and `instructor` (the instructor's name, NULL if none), covering every course.
---check
SELECT * FROM course_catalog ORDER BY code;
---solution
CREATE VIEW course_catalog AS
SELECT c.code, c.title, c.credits, i.name AS instructor
FROM courses c LEFT JOIN instructors i ON i.instructor_id = c.instructor_id;
:::

:::exercise
id: ddl-index
level: 2
title: Index the foreign key
---
Create an index named `idx_items_product` on `order_items(product_id)`.
---check
SELECT il.name, ii.name AS col FROM pragma_index_list('order_items') il
JOIN pragma_index_info(il.name) ii WHERE il.name = 'idx_items_product';
---solution
CREATE INDEX idx_items_product ON order_items(product_id);
:::

:::exercise
id: ddl-defaults
level: 2
title: Defaults and checks
---
Create `tickets` with: `ticket_id` INTEGER PRIMARY KEY, `subject` TEXT NOT NULL, `priority` TEXT NOT NULL with default `'normal'` and only allowing `'low'`, `'normal'`, `'high'`, and `status` TEXT NOT NULL default `'open'`.
---check
INSERT OR IGNORE INTO tickets (subject) VALUES ('printer jam');
INSERT OR IGNORE INTO tickets (subject, priority) VALUES ('server down', 'high');
INSERT OR IGNORE INTO tickets (subject, priority) VALUES ('bad priority', 'urgent');
INSERT OR IGNORE INTO tickets (priority) VALUES ('low');
SELECT subject, priority, status FROM tickets ORDER BY ticket_id;
---solution
CREATE TABLE tickets (
  ticket_id INTEGER PRIMARY KEY,
  subject   TEXT NOT NULL,
  priority  TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status    TEXT NOT NULL DEFAULT 'open'
);
:::

:::exercise
id: ddl-junction
level: 3
title: Many-to-many junction table
---
Books can have many tags and tags can label many books. First create `tags(tag_id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE)` and a simple `books(book_id INTEGER PRIMARY KEY, title TEXT)`. Then create the junction table `book_tags` with `book_id` and `tag_id`, both foreign keys, whose **primary key is the pair** of them.
---check
SELECT name, pk FROM pragma_table_info('book_tags') ORDER BY cid;
---solution
CREATE TABLE books (book_id INTEGER PRIMARY KEY, title TEXT);
CREATE TABLE tags (tag_id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE);
CREATE TABLE book_tags (
  book_id INTEGER REFERENCES books(book_id),
  tag_id  INTEGER REFERENCES tags(tag_id),
  PRIMARY KEY (book_id, tag_id)
);
:::

:::exercise
id: ddl-fk-cascade
level: 3
title: Cascading deletes
---
With foreign keys turned on (`PRAGMA foreign_keys = ON;`), create `playlists(playlist_id INTEGER PRIMARY KEY, name TEXT NOT NULL)` and `tracks(track_id INTEGER PRIMARY KEY, playlist_id INTEGER NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE, title TEXT NOT NULL)`.
---check
PRAGMA foreign_keys = ON;
INSERT INTO playlists VALUES (1, 'Focus'), (2, 'Gym');
INSERT INTO tracks VALUES (1, 1, 'Rain'), (2, 1, 'Waves'), (3, 2, 'Pump');
DELETE FROM playlists WHERE playlist_id = 1;
SELECT track_id, title FROM tracks ORDER BY track_id;
---solution
PRAGMA foreign_keys = ON;
CREATE TABLE playlists (playlist_id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE tracks (
  track_id    INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE,
  title       TEXT NOT NULL
);
:::

:::exercise
id: ddl-ctas
level: 3
title: Snapshot table
---
Create a table `honor_roll` from a query: the `student_id`, `first_name`, `last_name` and `gpa` of students with GPA 3.7 or above.
---check
SELECT * FROM honor_roll ORDER BY student_id;
---solution
CREATE TABLE honor_roll AS
SELECT student_id, first_name, last_name, gpa FROM students WHERE gpa >= 3.7;
:::

:::exercise
id: ddl-library
level: 4
title: Design a lending library
---
Create three tables enforcing these rules:

- `patrons`: `patron_id` INTEGER PRIMARY KEY, `name` TEXT NOT NULL, `email` TEXT NOT NULL UNIQUE
- `items`: `item_id` INTEGER PRIMARY KEY, `title` TEXT NOT NULL, `kind` TEXT NOT NULL limited to `'book'`, `'dvd'`, `'magazine'`
- `loans`: `loan_id` INTEGER PRIMARY KEY, `patron_id` and `item_id` (both required foreign keys), `loaned_on` TEXT NOT NULL, `due_on` TEXT NOT NULL, `returned_on` TEXT (nullable), with a CHECK that `due_on` is **after** `loaned_on`.

The grader inserts valid and invalid rows using `INSERT OR IGNORE` and counts what was accepted.
---check
INSERT OR IGNORE INTO patrons (name, email) VALUES ('Ana', 'ana@x.example'), ('Bo', 'ana@x.example'), ('Cy', 'cy@x.example'), (NULL, 'z@x.example');
INSERT OR IGNORE INTO items (title, kind) VALUES ('Dune', 'book'), ('Alien', 'dvd'), ('Wired', 'magazine'), ('Pong', 'game');
INSERT OR IGNORE INTO loans (patron_id, item_id, loaned_on, due_on) VALUES
  (1, 1, '2026-01-01', '2026-01-15'), (1, 2, '2026-01-10', '2026-01-05'), (2, 3, '2026-02-01', '2026-02-08'), (NULL, 1, '2026-03-01', '2026-03-10');
SELECT (SELECT COUNT(*) FROM patrons) AS patrons, (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM loans) AS loans;
---solution
CREATE TABLE patrons (
  patron_id INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  email     TEXT NOT NULL UNIQUE
);
CREATE TABLE items (
  item_id INTEGER PRIMARY KEY,
  title   TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('book', 'dvd', 'magazine'))
);
CREATE TABLE loans (
  loan_id     INTEGER PRIMARY KEY,
  patron_id   INTEGER NOT NULL REFERENCES patrons(patron_id),
  item_id     INTEGER NOT NULL REFERENCES items(item_id),
  loaned_on   TEXT NOT NULL,
  due_on      TEXT NOT NULL,
  returned_on TEXT,
  CHECK (due_on > loaned_on)
);
:::

:::exercise
id: proj-sql-14-reviews
level: 3
title: "Project 14: the time_entries table"
path: db/migrations/14-time-entries.sql
---
Create `time_entries`: `entry_id` integer primary key; `task_id` and `member_id`, both required and referencing `tasks` and `members`; `minutes`, a required integer that must be **greater than 0**; `logged_on`, required text; and an optional `note`. Then insert one entry: member **4** logged **90** minutes on task **2** on `2026-11-20` with the note `Token bucket prototype`.
---check
SELECT task_id, member_id, minutes, logged_on, note FROM time_entries
---solution
CREATE TABLE time_entries (entry_id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(task_id), member_id INTEGER NOT NULL REFERENCES members(member_id), minutes INTEGER NOT NULL CHECK (minutes > 0), logged_on TEXT NOT NULL, note TEXT);
INSERT INTO time_entries (task_id, member_id, minutes, logged_on, note) VALUES (2, 4, 90, '2026-11-20', 'Token bucket prototype');
:::

:::exercise
id: proj-sql-14-view
level: 3
title: "Project 14b: an open_tasks view"
path: db/migrations/14-open-tasks-view.sql
---
Create a view `open_tasks` with one row per task that is not `done`: `task_id`, `title`, `board` (the board's name), `assignee` (the member's name, NULL when unassigned) and `due_on`. The grader then queries it for the overdue ones.
---hint
Unassigned tasks must stay in the view, so join `members` with a LEFT JOIN.
---check
SELECT task_id, title, board, assignee, due_on FROM open_tasks WHERE due_on < '2026-11-20' ORDER BY task_id
---solution
CREATE VIEW open_tasks AS SELECT t.task_id, t.title, b.name AS board, m.name AS assignee, t.due_on FROM tasks t JOIN boards b ON b.board_id = t.board_id LEFT JOIN members m ON m.member_id = t.assignee_id WHERE t.status <> 'done';
:::
