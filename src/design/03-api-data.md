---
id: design-api-data
title: APIs, IDs & data models
summary: Designing a clean external API, choosing REST, gRPC or GraphQL, pagination, idempotency and optimistic concurrency, generating unique IDs (auto-increment, UUIDs, Snowflake-style, base62 codes, random codes with retries), and modeling the data for the access patterns.
minutes: 45
---
> [!project] Taskboard, step 3: API, IDs and schema
> This step pins down Taskboard's contract with the world at scale: its endpoints, how tasks get unique IDs without one central counter, how invite links get short unguessable codes, and the table that stores tasks.

## Worked example: Taskboard's public API

The FastAPI track built these endpoints for one small team. At scale the contract grows a version number, workspaces (one per customer team), and a few safety features:

```http
POST /api/v1/workspaces/7/tasks
Authorization: Bearer …
Idempotency-Key: 7c9e6b0a-…
{"board_id": 12, "title": "Write the release notes", "assignee_id": 31}

201 Created
Location: /api/v1/tasks/1859112334470283264
{"id": 1859112334470283264, "key": "TB-1042", "title": "Write the release notes", "status": "todo", "version": 1}
```

```http
PATCH /api/v1/tasks/1859112334470283264
If-Match: 1
{"status": "doing"}

200 OK                               (or 412 Precondition Failed if version 1 is no longer current)
{"id": 1859112334470283264, "status": "doing", "version": 2}
```

```http
GET /api/v1/boards/12/tasks?status=doing&limit=50&after=eyJpZCI6…
```

Decisions worth explaining:

- **Versioned path** (`/api/v1`): mobile apps and integrations keep calling the old shape for years, so a breaking change ships as `/api/v2` while `v1` keeps working.
- **Idempotency-Key** on POST: if the client times out and retries, the server sees the same key and returns the task it already created instead of creating a duplicate. (A request is **idempotent** when repeating it has the same effect as doing it once. GET, PUT and DELETE are idempotent by definition; POST isn't, which is why it needs the key.)
- **Optimistic concurrency** with a `version` number: two teammates open the same task; both edit it. Each PATCH says which version it was based on (`If-Match: 1`). The first one wins and bumps the version to 2; the second gets **412 Precondition Failed** instead of silently overwriting the first person's change, and the app asks them to reload. Nothing is locked while people think, which is why it's called *optimistic*.

## REST, gRPC or GraphQL?

| | REST/JSON | gRPC | GraphQL |
|---|---|---|---|
| good for | public APIs, browsers, simple resources | internal service-to-service, low latency, streaming | clients that need flexible, nested queries (mobile apps) |
| format | text JSON over HTTP | binary Protobuf over HTTP/2 | JSON over HTTP, one endpoint |
| contract | OpenAPI (optional) | `.proto` files (required, code-generated) | schema (required) |

Taskboard's public API is REST; its internal services (lesson 9) could talk gRPC.

## Pagination

Never return unbounded lists: a board with 20,000 old tasks would be a 20 MB response. Two styles:

- **Offset**: `?offset=40&limit=20`. Simple, allows jumping to page N, but slow for deep pages (the database still walks past the first 40 rows) and unstable when rows are inserted (items shift between pages).
- **Cursor** (keyset): `?after=<cursor>&limit=20`, where the response includes a `next_cursor` that encodes where this page ended (for example, the last task's `updated_at` and `id`). The database seeks straight there with an index, so it's fast at any depth and stable while data changes. Preferred for large or live data like boards and activity feeds.

## Generating IDs

Taskboard needs two kinds of identifiers:

1. **Task IDs**: unique across all workspaces and servers, created thousands of times a second.
2. **Invite codes**: short, unguessable strings in links like `taskboard.app/join/aZ3kQ9b` that let someone join a workspace.

| Approach | How | Pros | Cons |
|---|---|---|---|
| auto-increment | the database counts 1, 2, 3… | short, unique, simple | one counter is a bottleneck and a single point of failure; sequential numbers are guessable |
| UUID | 128 random bits | no coordination, collisions practically impossible | 36 characters; random order makes indexes slower |
| Snowflake-style | 64 bits: timestamp + machine id + per-machine sequence | unique, roughly time-sortable, no coordination | needs a unique machine id per server |
| random base62 | 7 random characters from `0-9a-zA-Z` | short, unguessable | collisions possible: check and retry |
| pre-generated pool | a service creates unused codes ahead of time; servers take batches | fast, no collisions | an extra component |

Taskboard uses **Snowflake-style IDs** for tasks (the long number in the example above) and **random base62 codes** for invites. The friendly `TB-1042` key is a per-workspace counter: it only has to be unique inside one workspace, so it never becomes a global bottleneck.

### Base62

Base62 writes numbers with 62 digit symbols (`0-9`, then `a-z`, then `A-Z`) instead of 10. In base 10, 125 is 1 hundred, 2 tens and 5 ones; in base 62, 125 = 2 × 62 + 1, so it's the two digits `2` and `1`: the string `"21"`. Seven base62 characters can count to 62⁷ ≈ **3.5 trillion**.

To convert, repeatedly divide by 62 and keep the remainders. Python's `divmod(n, 62)` returns both at once (the quotient and the remainder). The remainders come out last digit first, so reverse them at the end:

```python
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

def base62(n: int) -> str:
    if n == 0:
        return ALPHABET[0]
    out = []
    while n > 0:
        n, r = divmod(n, 62)       # n becomes n // 62, r is n % 62
        out.append(ALPHABET[r])    # the remainder picks the digit symbol
    return "".join(reversed(out))  # last digit came out first
```

### Random codes with retries

An invite code must be **unguessable**, or anyone could join any workspace by trying codes. Python's `random` module is predictable by design; its `secrets` module produces cryptographically secure randomness for exactly this job. `secrets.choice(ALPHABET)` picks one random character; joining seven of them builds a code:

```python
import secrets

code = "".join(secrets.choice(ALPHABET) for _ in range(7))   # e.g. "aZ3kQ9b"
```

`"".join(...)` glues strings together with nothing between them; `for _ in range(7)` repeats seven times (`_` is the conventional name for a loop variable you don't use).

With 3.5 trillion possible codes and a few million in use, a random code almost never collides with an existing one. "Almost never" still happens at scale, so check and retry a few times, then give up loudly:

```python
for _ in range(5):                 # up to 5 attempts
    code = make_code()
    if not exists(code):           # exists() asks the database
        return code
raise RuntimeError("could not allocate a unique code")
```

> [!plain] In plain English
> Base62 is counting with 62 different digit symbols, so a few characters can stand for a huge number. For codes people must not guess, pick the characters with `secrets`, check the code isn't taken, and try again if it is.

## Data model

Model for the **access patterns**. Taskboard's hottest query is "the tasks on board 12 in the `doing` column, most recently updated first". A table and an index that match it:

```sql
CREATE TABLE tasks (
  id            BIGINT PRIMARY KEY,           -- Snowflake-style id
  workspace_id  BIGINT NOT NULL,
  board_id      BIGINT NOT NULL,
  title         VARCHAR(200) NOT NULL,
  status        VARCHAR(10) NOT NULL,         -- todo, doing or done
  assignee_id   BIGINT,                       -- NULL when unassigned
  version       INT NOT NULL,                 -- for optimistic concurrency
  updated_at    TIMESTAMP NOT NULL
);
CREATE INDEX tasks_board ON tasks (board_id, status, updated_at);
```

`CREATE TABLE` defines the columns and their types (`BIGINT` is a 64-bit integer, `VARCHAR(200)` text of up to 200 characters); `NOT NULL` makes a column required; `PRIMARY KEY` makes it the unique identifier. `CREATE INDEX name ON table (columns)` builds a sorted lookup structure, so the database finds "board 12, status doing" without scanning every task. (The SQL track covers these statements in depth in lessons 14 and 15.)

What's deliberately **not** here: a "view count" column updated on every board load. At 30,000 reads/s, that would turn every read into a write on the hottest rows. Counters and activity go elsewhere (lesson 7).

:::quiz
q: Two teammates edit the same task. With optimistic concurrency, what happens to the second save?
+ it's rejected (412) because the version it was based on is no longer current, so the user reloads instead of overwriting
- it silently overwrites the first change
- it waits until the first user closes the task
- both changes are merged automatically
why: Each save names the version it read; the server only accepts the current one.
:::

:::quiz
q: How many distinct 7-character base62 codes are there, roughly?
- 7 million
- 62 million
+ 3.5 trillion
- 10¹⁰⁰
why: 62⁷ ≈ 3.52 × 10¹².
:::

:::quiz
q: Which pagination style stays fast and stable for deep pages of live data?
- offset/limit
+ cursor (keyset) pagination
- returning everything
- page numbers in the path
why: A cursor seeks directly to where the previous page ended.
:::

:::quiz
q: What does an Idempotency-Key on `POST /tasks` prevent?
+ duplicate tasks when a client retries a request whose response it never received
- unauthorized access
- slow responses
- invalid titles
why: The server returns the first result for a repeated key.
:::

:::quiz
q: Why generate invite codes with `secrets` rather than `random`?
+ `secrets` is unpredictable; `random` can be predicted, so codes could be guessed
- `secrets` is faster
- `random` can't produce letters
- `secrets` never produces duplicates
why: Security-sensitive values need a cryptographically secure source; duplicates are still possible, hence the retry.
:::

:::exercise
id: da-base62
level: 3
title: Base62 encode
mode: code
lang: python
file: codes.py
---
Implement `base62(n: int) -> str` using the given `ALPHABET`: return `ALPHABET[0]` for 0; otherwise repeatedly `divmod(n, 62)`, collect the remainder characters, and return them **reversed** as a string.
---starter
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
---rule
def\s+base62\(\s*n\s*:\s*int\s*\)\s*->\s*str\s*:
The signature
---rule
if\s+n\s*==\s*0\s*:\s*\n\s+return\s+ALPHABET\[\s*0\s*\]
Zero case
---rule
while\s+n\s*>\s*0\s*:
Loop while n > 0
---rule
n\s*,\s*(\w+)\s*=\s*divmod\(\s*n\s*,\s*62\s*\)
`divmod(n, 62)`
---rule
\.append\(\s*ALPHABET\[\s*\w+\s*\]\s*\)|\+=\s*ALPHABET\[\s*\w+\s*\]
Collect characters
---rule
reversed\(|\[\s*::\s*-1\s*\]
Reverse at the end
---solution
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def base62(n: int) -> str:
    if n == 0:
        return ALPHABET[0]
    out = []
    while n > 0:
        n, r = divmod(n, 62)
        out.append(ALPHABET[r])
    return "".join(reversed(out))
:::

:::exercise
id: da-predict-base62
level: 2
title: Predict: encode 125
mode: answer
---
With the alphabet `0-9`, then `a-z`, then `A-Z`, what is `base62(125)`?
---answer
21
---solution
21
---explain
125 = 2 × 62 + 1, so the digits are 2 and 1.
:::

:::exercise
id: proj-design-03-random
level: 3
title: "Project 3: invite codes with retries"
mode: code
lang: python
file: invites.py
path: docs/design/invites.py
---
Write `new_invite_code(exists, length: int = 7, attempts: int = 5) -> str` that builds a code with `"".join(secrets.choice(ALPHABET) for _ in range(length))`, returns it if `exists(code)` is false, tries up to `attempts` times, and finally raises `RuntimeError("could not allocate a unique code")`. (`exists` is a function you're given: it returns `True` if the code is already taken.)
---starter
import secrets

ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
---hint
The lesson's "Random codes with retries" section has both pieces: building one code, and the retry loop.
---rule
def\s+new_invite_code\(\s*exists\s*,\s*length\s*:\s*int\s*=\s*7\s*,\s*attempts\s*:\s*int\s*=\s*5\s*\)
The signature
---rule
for\s+_\s+in\s+range\(\s*attempts\s*\)\s*:
Retry loop
---rule
["']["']\.join\(\s*secrets\.choice\(\s*ALPHABET\s*\)\s+for\s+_\s+in\s+range\(\s*length\s*\)\s*\)
Cryptographically random code
---rule
if\s+not\s+exists\(\s*\w+\s*\)\s*:\s*\n\s+return\s+\w+
Return it when free
---rule
raise\s+RuntimeError\(\s*["']could not allocate a unique code["']\s*\)
Give up after the attempts
---solution
import secrets

ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def new_invite_code(exists, length: int = 7, attempts: int = 5) -> str:
    for _ in range(attempts):
        code = "".join(secrets.choice(ALPHABET) for _ in range(length))
        if not exists(code):
            return code
    raise RuntimeError("could not allocate a unique code")
:::

:::exercise
id: proj-design-03-schema
level: 2
title: "Project 3b: the tasks table"
mode: code
lang: sql
file: schema.sql
path: docs/design/schema.sql
---
Write the lesson's `CREATE TABLE tasks` with these columns: `id BIGINT PRIMARY KEY`, `workspace_id BIGINT NOT NULL`, `board_id BIGINT NOT NULL`, `title VARCHAR(200) NOT NULL`, `status VARCHAR(10) NOT NULL`, `assignee_id BIGINT`, `version INT NOT NULL`, `updated_at TIMESTAMP NOT NULL`. Then add the index `tasks_board` on `(board_id, status, updated_at)`.
---starter
-- Taskboard schema
---rule
CREATE\s+TABLE\s+tasks\s*\(
`CREATE TABLE tasks`
---rule
\bid\s+BIGINT\s+PRIMARY\s+KEY
`id` primary key
---rule
workspace_id\s+BIGINT\s+NOT\s+NULL
`workspace_id`
---rule
board_id\s+BIGINT\s+NOT\s+NULL
`board_id`
---rule
title\s+VARCHAR\(\s*200\s*\)\s+NOT\s+NULL
`title`
---rule
status\s+VARCHAR\(\s*10\s*\)\s+NOT\s+NULL
`status`
---rule
assignee_id\s+BIGINT\s*(,|\n|\))
`assignee_id` (nullable)
---rule
version\s+INT\s+NOT\s+NULL
`version`
---rule
updated_at\s+TIMESTAMP\s+NOT\s+NULL
`updated_at`
---rule
CREATE\s+INDEX\s+tasks_board\s+ON\s+tasks\s*\(\s*board_id\s*,\s*status\s*,\s*updated_at\s*\)
Index for the board query
---solution
CREATE TABLE tasks (
  id            BIGINT PRIMARY KEY,
  workspace_id  BIGINT NOT NULL,
  board_id      BIGINT NOT NULL,
  title         VARCHAR(200) NOT NULL,
  status        VARCHAR(10) NOT NULL,
  assignee_id   BIGINT,
  version       INT NOT NULL,
  updated_at    TIMESTAMP NOT NULL
);
CREATE INDEX tasks_board ON tasks (board_id, status, updated_at);
:::

:::exercise
id: proj-design-03-conflict
level: 2
title: "Project 3c: the losing save"
mode: answer
---
Ana and Ben both open task TB-1042 at version 3. Ana saves first. Ben then sends `PATCH` with `If-Match: 3`. What HTTP status code does Ben get?
---answer
412
---answer
412 Precondition Failed
---solution
412
---explain
Ana's save made the task version 4, so Ben's precondition (version 3) no longer holds.
:::
