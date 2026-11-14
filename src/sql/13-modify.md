---
id: sql-dml
title: INSERT, UPDATE, DELETE
summary: Changing data safely — inserting rows (including from a SELECT), updating with conditions and subqueries, deleting, upserts, and transactions.
minutes: 30
---
> [!project] Desk & Co, step 13: running the shop, not just reading it
> So far you've only read data. Now Maya needs changes: record a new order, adjust prices, update stock. Each change must leave the data consistent, which is what transactions are for.

## Data Manipulation Language

`SELECT` reads; **DML** statements change data. Exercises in this module are graded by running a *check query* against the database after your statements, so you'll see the resulting state. Every run starts from a fresh copy: nothing you do here is permanent.

## INSERT

Name the columns, then supply values in the same order:

```sql run
INSERT INTO departments (dept_id, name, building, budget)
VALUES (7, 'Legal', 'Winslow', 400000);

SELECT * FROM departments;
```

- Columns you omit get their **default** (or NULL).
- An `INTEGER PRIMARY KEY` you omit is assigned automatically (the next rowid).
- Insert several rows at once with comma-separated tuples.

```sql run
INSERT INTO products (name, category, price, stock) VALUES
  ('Monitor Arm', 'Accessories', 64.00, 25),
  ('Footrest',    'Furniture',   38.50, 10);

SELECT product_id, name, price FROM products ORDER BY product_id DESC LIMIT 3;
```

> [!warn] Always list the columns
> `INSERT INTO t VALUES (…)` without a column list depends on the table's column order, which breaks as soon as someone adds a column.

### INSERT … SELECT

Insert the result of a query: perfect for archiving or copying.

```sql run
CREATE TABLE big_orders (order_id INTEGER, total REAL);

INSERT INTO big_orders (order_id, total)
SELECT order_id, SUM(quantity * unit_price)
FROM order_items GROUP BY order_id HAVING SUM(quantity * unit_price) > 700;

SELECT * FROM big_orders;
```

## UPDATE

```sql
UPDATE table SET col1 = expr1, col2 = expr2 WHERE condition;
```

The `SET` expressions can use the row's current values:

```sql run
UPDATE employees SET salary = salary * 1.05 WHERE dept_id = 4;

SELECT first_name, salary FROM employees WHERE dept_id = 4;
```

> [!exam] UPDATE without WHERE
> An `UPDATE` (or `DELETE`) with no `WHERE` affects **every row**. Before running one for real, run a `SELECT` with the same WHERE to see which rows you'll hit.

### UPDATE with subqueries

The condition or the new value can come from other tables:

```sql run
-- 10% raise for everyone in Engineering, located by name
UPDATE employees
SET salary = ROUND(salary * 1.10)
WHERE dept_id = (SELECT dept_id FROM departments WHERE name = 'Engineering');

SELECT first_name, salary FROM employees WHERE dept_id = 1;
```

```sql run
-- correlated: set each product's stock to units sold so far (a silly but illustrative update)
UPDATE products
SET stock = (SELECT COALESCE(SUM(quantity), 0) FROM order_items oi WHERE oi.product_id = products.product_id);

SELECT name, stock FROM products LIMIT 5;
```

SQLite 3.33+ and PostgreSQL also support `UPDATE … FROM other_table` for join-style updates.

## DELETE

```sql run
DELETE FROM orders WHERE status = 'cancelled';
SELECT status, COUNT(*) FROM orders GROUP BY status;
```

Deleting rows that other rows reference (like orders that still have order_items) leaves orphans unless foreign keys are enforced: `PRAGMA foreign_keys = ON` in SQLite, with `ON DELETE CASCADE` or `RESTRICT` on the constraint. That's the next module.

## UPSERT: insert or update

"Insert this row, or if its key already exists, update it instead." Standard-ish syntax (SQLite, PostgreSQL):

```sql run
INSERT INTO products (product_id, name, category, price, stock)
VALUES (2, 'Wireless Mouse', 'Electronics', 22.99, 150)
ON CONFLICT (product_id) DO UPDATE SET price = excluded.price, stock = excluded.stock;

SELECT * FROM products WHERE product_id = 2;
```

`excluded` refers to the row you tried to insert. `ON CONFLICT DO NOTHING` silently skips duplicates. MySQL spells it `ON DUPLICATE KEY UPDATE`.

## RETURNING

SQLite 3.35+ and PostgreSQL can return the affected rows:

```sql run
UPDATE products SET price = price - 5 WHERE category = 'Home' RETURNING name, price;
```

## Transactions

A **transaction** groups statements so they succeed or fail as a unit (**atomicity**). Classic example: moving money must debit one account and credit another, never just one.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;      -- make both permanent
-- or ROLLBACK; to undo everything since BEGIN
```

```sql run
BEGIN;
DELETE FROM order_items;
SELECT COUNT(*) AS during FROM order_items;
ROLLBACK;
SELECT COUNT(*) AS after_rollback FROM order_items;
```

Transactions provide the **ACID** guarantees: **A**tomicity (all or nothing), **C**onsistency (constraints hold before and after), **I**solation (concurrent transactions don't see each other's partial work), **D**urability (committed data survives crashes).

## Worked example: placing an order safely

A new order touches **three** tables: a row in `orders`, rows in `order_items`, and lower `stock` in `products`. If the program crashed halfway, you'd have an order without lines, or lines without the stock reduction. Wrap the steps in a transaction so they happen all together or not at all:

```sql
BEGIN;
INSERT INTO orders (order_id, customer_id, order_date, status) VALUES (41, 3, '2025-11-20', 'pending');
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (41, 2, 2, 24.99);
UPDATE products SET stock = stock - 2 WHERE product_id = 2;
COMMIT;
```

If a statement fails before `COMMIT`, handle the error and run `ROLLBACK` instead of continuing to commit. A failed statement does not necessarily roll back the whole transaction automatically.

> [!plain] In plain English
> A transaction is a promise: "these statements count as **one** change". Other users never see the half-finished state.

## Write the SELECT first

Before an `UPDATE` or `DELETE`, run the same `WHERE` as a `SELECT` and look at what you're about to change:

```sql run
SELECT product_id, name, price FROM products WHERE category = 'Stationery';
```

Only when those are exactly the right rows, turn it into:

```sql
UPDATE products SET price = ROUND(price * 1.05, 2) WHERE category = 'Stationery';
```

## Common mistakes

> [!mistake] UPDATE or DELETE without WHERE
> `UPDATE products SET price = 0` changes **every** row. Many teams require a `WHERE` in review, and some clients refuse to run one without it.

> [!mistake] Copying the current price into order lines incorrectly
> Notice `order_items` stores `unit_price` separately from `products.price`. That's deliberate: prices change, but an old order must keep the price the customer actually paid. Never "fix" old order lines when you change the catalog.

:::quiz
q: What does `UPDATE products SET price = 0;` do?
- Nothing without WHERE
- Errors
+ Sets the price of every product to 0
- Updates only the first row
why: No WHERE means every row. Always preview with a SELECT using the same WHERE.
:::

:::quiz
q: In `INSERT … ON CONFLICT (id) DO UPDATE SET qty = excluded.qty`, what is `excluded`?
- the existing row in the table
+ the row that failed to insert
- a deleted row
- a temporary table you must create
why: `excluded.col` is the value from the proposed insert.
:::

:::quiz
q: Which ACID property guarantees that a transfer can't debit one account without crediting the other?
+ Atomicity
- Consistency
- Isolation
- Durability
why: Atomicity means the transaction's statements all happen or none do.
:::

:::quiz
q: After `BEGIN; DELETE FROM t; ROLLBACK;`, table t has…
- no rows
+ the same rows as before BEGIN
- half its rows
- only rows inserted after ROLLBACK
why: ROLLBACK undoes every change since BEGIN.
:::

:::exercise
id: dml-insert-dept
level: 1
title: Add a department
---
Insert a department with `dept_id` 7, name `Legal`, building `Winslow`, budget `400000`.
---check
SELECT * FROM departments ORDER BY dept_id;
---solution
INSERT INTO departments (dept_id, name, building, budget) VALUES (7, 'Legal', 'Winslow', 400000);
:::

:::exercise
id: dml-insert-student
level: 1
title: New student
---
Insert student `1031`: `Riley Quinn`, major `Statistics`, year `1`, no GPA yet, email `rileyq@ncsu.example`, enrolled on `2026-08-17`.
---check
SELECT * FROM students WHERE student_id > 1028 ORDER BY student_id;
---solution
INSERT INTO students (student_id, first_name, last_name, major, year, gpa, email, enrolled_on)
VALUES (1031, 'Riley', 'Quinn', 'Statistics', 1, NULL, 'rileyq@ncsu.example', '2026-08-17');
:::

:::exercise
id: dml-update-price
level: 1
title: Price cut
---
The `Desk Lamp` now costs `28.00`. Update it.
---check
SELECT name, price FROM products ORDER BY product_id;
---solution
UPDATE products SET price = 28.00 WHERE name = 'Desk Lamp';
:::

:::exercise
id: dml-delete-cancelled
level: 2
title: Purge cancelled orders' items
---
Delete every row in `order_items` that belongs to a **cancelled** order.
---check
SELECT order_id, COUNT(*) AS items FROM order_items GROUP BY order_id ORDER BY order_id;
---solution
DELETE FROM order_items WHERE order_id IN (SELECT order_id FROM orders WHERE status = 'cancelled');
:::

:::exercise
id: dml-raise-support
level: 2
title: Support team raise
---
Give everyone in the **Support** department a 4% raise, rounded to whole dollars. Look the department up by name.
---check
SELECT emp_id, salary FROM employees ORDER BY emp_id;
---solution
UPDATE employees SET salary = ROUND(salary * 1.04)
WHERE dept_id = (SELECT dept_id FROM departments WHERE name = 'Support');
:::

:::exercise
id: dml-multi-insert
level: 2
title: Restock shipment
---
Add three new products in one statement: `Ergonomic Mouse` (Electronics, 49.99, stock 20), `Plant Stand` (Home, 27.50, stock 15), `Sticky Notes` (Stationery, 4.25, stock 400). Let SQLite assign the ids.
---check
SELECT name, category, price, stock FROM products ORDER BY product_id;
---solution
INSERT INTO products (name, category, price, stock) VALUES
  ('Ergonomic Mouse', 'Electronics', 49.99, 20),
  ('Plant Stand', 'Home', 27.50, 15),
  ('Sticky Notes', 'Stationery', 4.25, 400);
:::

:::exercise
id: dml-case-update
level: 3
title: Tiered discount
---
Apply a tiered price change in a **single UPDATE**: products over 200 get 15% off, products from 50 to 200 get 10% off, everything else is unchanged. Round new prices to 2 decimals.
---hint
`SET price = CASE WHEN … THEN … ELSE price END`
---check
SELECT product_id, price FROM products ORDER BY product_id;
---solution
UPDATE products SET price = ROUND(CASE
  WHEN price > 200 THEN price * 0.85
  WHEN price >= 50 THEN price * 0.90
  ELSE price END, 2);
:::

:::exercise
id: dml-insert-select
level: 3
title: Archive old orders
---
Create a table `orders_archive` with the same columns as `orders` (`order_id`, `customer_id`, `order_date`, `status`), copy every order from **before 2025-04-01** into it, then delete those orders from `orders`.
---hint
`CREATE TABLE orders_archive AS SELECT …` creates and fills in one go. Or CREATE then INSERT … SELECT.
---check
SELECT 'archive' AS t, COUNT(*), MIN(order_date), MAX(order_date) FROM orders_archive
UNION ALL
SELECT 'live', COUNT(*), MIN(order_date), MAX(order_date) FROM orders;
---solution
CREATE TABLE orders_archive (order_id INTEGER, customer_id INTEGER, order_date TEXT, status TEXT);
INSERT INTO orders_archive SELECT order_id, customer_id, order_date, status FROM orders WHERE order_date < '2025-04-01';
DELETE FROM orders WHERE order_date < '2025-04-01';
:::

:::exercise
id: dml-correlated-update
level: 3
title: Store order counts on customers
---
Add a column `orders_count INTEGER DEFAULT 0` to `customers`, then fill it with each customer's number of orders.
---hint
`ALTER TABLE customers ADD COLUMN …`, then a correlated UPDATE.
---check
SELECT customer_id, orders_count FROM customers ORDER BY customer_id;
---solution
ALTER TABLE customers ADD COLUMN orders_count INTEGER DEFAULT 0;
UPDATE customers SET orders_count = (SELECT COUNT(*) FROM orders o WHERE o.customer_id = customers.customer_id);
:::

:::exercise
id: dml-upsert
level: 3
title: Upsert inventory
---
In **one** statement, upsert two products: product `4` (`USB-C Hub`, Electronics, 39.50) now has stock `35`, and a new product `16` (`HDMI Cable`, Accessories, 12.99) with stock `80`. For existing ids, only `stock` should change.
---check
SELECT product_id, name, price, stock FROM products WHERE product_id IN (4, 16) ORDER BY product_id;
---solution
INSERT INTO products (product_id, name, category, price, stock) VALUES
  (4, 'USB-C Hub', 'Electronics', 39.50, 35),
  (16, 'HDMI Cable', 'Accessories', 12.99, 80)
ON CONFLICT (product_id) DO UPDATE SET stock = excluded.stock;
:::

:::exercise
id: dml-decrement-stock
level: 4
title: Ship the pending orders
---
All **pending** orders just shipped. In order: (1) reduce each product's `stock` by the total quantity of that product across pending orders, and (2) mark those orders `shipped`. Products not in any pending order keep their stock. (Stock may go negative; that's a separate problem.)
---hint
Update products first, while the orders are still 'pending'. Use a correlated subquery with COALESCE for the quantity, and restrict to products that appear in pending orders.
---check
SELECT p.product_id, p.stock, (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS still_pending
FROM products p ORDER BY p.product_id;
---solution
UPDATE products
SET stock = stock - (SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.order_id = oi.order_id
                     WHERE o.status = 'pending' AND oi.product_id = products.product_id)
WHERE product_id IN (SELECT oi.product_id FROM order_items oi JOIN orders o ON o.order_id = oi.order_id WHERE o.status = 'pending');
UPDATE orders SET status = 'shipped' WHERE status = 'pending';
:::

:::exercise
id: dml-dedupe
level: 4
title: Remove duplicates, keep the first
---
Someone accidentally ran an import twice. Run this setup at the top of your answer, then delete the duplicates so each `(name, city)` pair keeps only the row with the **lowest `id`**:

```sql
CREATE TABLE leads (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
INSERT INTO leads (name, city) VALUES
 ('Ana','Raleigh'),('Bo','Durham'),('Ana','Raleigh'),('Cy','Cary'),('Bo','Durham'),('Bo','Durham'),('Di','Raleigh');
```
---hint
Delete rows whose id is not the MIN(id) of their group: `WHERE id NOT IN (SELECT MIN(id) FROM leads GROUP BY name, city)`.
---check
SELECT id, name, city FROM leads ORDER BY id;
---solution
CREATE TABLE leads (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
INSERT INTO leads (name, city) VALUES
 ('Ana','Raleigh'),('Bo','Durham'),('Ana','Raleigh'),('Cy','Cary'),('Bo','Durham'),('Bo','Durham'),('Di','Raleigh');
DELETE FROM leads WHERE id NOT IN (SELECT MIN(id) FROM leads GROUP BY name, city);
:::

:::exercise
id: proj-sql-13-place-order
level: 3
title: "Project 13: place an order"
---
Record a new order in one transaction: order **41** for customer **3** on `2025-11-20` with status `pending`, containing **2 × product 2** at the unit price of `24.99`, and reduce product 2's stock by 2.
---check
SELECT o.order_id, o.customer_id, o.status, oi.product_id, oi.quantity, oi.unit_price, p.stock FROM orders o JOIN order_items oi ON oi.order_id = o.order_id JOIN products p ON p.product_id = oi.product_id WHERE o.order_id = 41;
---solution
BEGIN;
INSERT INTO orders (order_id, customer_id, order_date, status) VALUES (41, 3, '2025-11-20', 'pending');
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (41, 2, 2, 24.99);
UPDATE products SET stock = stock - 2 WHERE product_id = 2;
COMMIT;
:::

:::exercise
id: proj-sql-13-reprice
level: 2
title: "Project 13b: a price increase"
---
Raise the price of every `Stationery` product by **5%**, rounded to 2 decimals. Leave other categories alone.
---check
SELECT name, category, price FROM products ORDER BY product_id;
---solution
UPDATE products SET price = ROUND(price * 1.05, 2) WHERE category = 'Stationery';
:::

:::exercise
id: proj-sql-13-ship
level: 2
title: "Project 13c: ship the backlog"
---
Every `pending` order placed **before** `2025-10-01` has now shipped. Update their status to `shipped`.
---check
SELECT order_id, order_date, status FROM orders WHERE status IN ('pending', 'shipped') ORDER BY order_id;
---solution
UPDATE orders SET status = 'shipped' WHERE status = 'pending' AND order_date < '2025-10-01';
:::
