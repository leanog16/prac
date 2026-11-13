---
id: design-api-data
title: APIs, IDs & data models
summary: Designing a clean external API, choosing REST, gRPC or GraphQL, pagination and idempotency, generating unique IDs (auto-increment, UUIDs, Snowflake-style, base62 short codes, hashing), and modeling the data for the access patterns.
minutes: 40
---
> [!project] Snip, step 3: API, codes and schema
> This step pins down Snip's contract with the world: its endpoints, how a 7-character short code is generated without collisions, and the table that stores links.

## Worked example: Snip's API

```http
POST /api/v1/links
Authorization: Bearer …
Idempotency-Key: 7c9e…
{"url": "https://example.com/a/very/long/path?with=params", "alias": null, "expires_at": "2027-01-01T00:00:00Z"}

201 Created
Location: /api/v1/links/aZ3kQ9b
{"code": "aZ3kQ9b", "short_url": "https://snip.ly/aZ3kQ9b", "url": "https://example.com/…", "expires_at": "2027-01-01T00:00:00Z"}
```

```http
GET /aZ3kQ9b

302 Found                                   (or 301 Moved Permanently)
Location: https://example.com/a/very/long/path?with=params
```

```http
GET /api/v1/links/aZ3kQ9b/stats?from=2026-11-01&to=2026-11-30
DELETE /api/v1/links/aZ3kQ9b
```

Decisions worth explaining:

- **301 vs 302**: browsers cache a 301 forever and never ask Snip again. That's fast and cheap, but Snip loses click counts and can't change or expire the link. Snip uses **302** (or 307) because statistics and expiry matter.
- **Versioned path** (`/api/v1`): the redirect path (`/aZ3kQ9b`) is not versioned, because short links live forever.
- **Idempotency-Key** on POST: if the client retries after a timeout, Snip returns the original link instead of creating a duplicate.

## REST, gRPC or GraphQL?

| | REST/JSON | gRPC | GraphQL |
|---|---|---|---|
| good for | public APIs, browsers, simple resources | internal service-to-service, low latency, streaming | clients that need flexible, nested queries (mobile apps) |
| format | text JSON over HTTP | binary Protobuf over HTTP/2 | JSON over HTTP, one endpoint |
| contract | OpenAPI (optional) | `.proto` files (required, code-generated) | schema (required) |

Snip's public API is REST; if it grew internal services, they might talk gRPC.

## Pagination

Never return unbounded lists. Two styles:

- **Offset**: `?offset=40&limit=20`. Simple, allows jumping to page N, but slow for deep pages and unstable when rows are inserted.
- **Cursor** (keyset): `?after=aZ3kQ9b&limit=20`, returning a `next_cursor`. Fast at any depth and stable, so it's preferred for large or live data (feeds, a user's links).

## Generating IDs

Snip needs short codes that are **unique**, **short** and **not guessable in sequence**. Options:

| Approach | How | Pros | Cons |
|---|---|---|---|
| auto-increment + base62 | DB sequence 125 → `"21"` | short, unique, simple | one sequence is a bottleneck/single point; sequential codes are guessable |
| random base62 | 7 random chars | no coordination | collisions possible: check and retry |
| hash of URL | first 7 chars of base62(SHA-256(url)) | same URL → same code | collisions; can't make two codes for one URL |
| UUID | 128-bit random | no coordination, no collisions in practice | 22+ chars: too long for a short link |
| Snowflake-style | timestamp + machine id + sequence in 64 bits | sortable, unique, no coordination | ~11 base62 chars |
| pre-generated key pool | a service generates unused codes ahead of time; app servers take batches | fast, no collisions, no hot sequence | an extra component |

How big is the space? Base62 (`0-9a-zA-Z`) with 7 characters: 62⁷ ≈ **3.5 trillion** codes. Snip needs 6 billion over 5 years, about 0.2% of the space, so random codes rarely collide, and a retry on collision is cheap.

**Base62 encoding** turns a number into such a string:

```python
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

def base62(n: int) -> str:
    if n == 0:
        return ALPHABET[0]
    out = []
    while n > 0:
        n, r = divmod(n, 62)
        out.append(ALPHABET[r])
    return "".join(reversed(out))
```

> [!plain] In plain English
> Base62 is like counting in a number system with 62 digits instead of 10. Seven of those "digits" can count to 3.5 trillion, which is plenty of unique short codes.

## Data model

Model for the **access patterns**: the hottest query is "code → URL", by primary key.

```sql
CREATE TABLE links (
  code        VARCHAR(10) PRIMARY KEY,      -- the hot lookup
  long_url    TEXT        NOT NULL,
  owner_id    BIGINT,
  created_at  TIMESTAMP   NOT NULL,
  expires_at  TIMESTAMP
);
CREATE INDEX links_owner ON links (owner_id, created_at);   -- "my links" page
```

Click statistics are **not** stored by updating a counter on this row: at 10,000 redirects/s, that would turn every read into a write on the hottest rows. Clicks go elsewhere (lesson 7).

:::quiz
q: Why does Snip redirect with 302 rather than 301?
+ browsers cache 301s permanently, so Snip would lose click statistics and the ability to expire or change links
- 301 isn't a valid redirect
- 302 is faster
- 301 requires HTTPS
why: Analytics and expiry need every click to reach Snip.
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
q: What does an Idempotency-Key on `POST /links` prevent?
+ duplicate links when a client retries a request whose response it never received
- unauthorized access
- slow responses
- invalid URLs
why: The server returns the first result for a repeated key.
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
title: "Project 3: random codes with retries"
mode: code
lang: python
file: codes.py
---
Write `new_code(exists, length: int = 7, attempts: int = 5) -> str` that generates `"".join(secrets.choice(ALPHABET) for _ in range(length))`, returns it if `exists(code)` is false, retries up to `attempts` times, and finally raises `RuntimeError("could not allocate a unique code")`.
---starter
import secrets

ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
---rule
def\s+new_code\(\s*exists\s*,\s*length\s*:\s*int\s*=\s*7\s*,\s*attempts\s*:\s*int\s*=\s*5\s*\)
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


def new_code(exists, length: int = 7, attempts: int = 5) -> str:
    for _ in range(attempts):
        code = "".join(secrets.choice(ALPHABET) for _ in range(length))
        if not exists(code):
            return code
    raise RuntimeError("could not allocate a unique code")
:::

:::exercise
id: proj-design-03-schema
level: 2
title: "Project 3b: Snip's table"
mode: code
lang: sql
file: schema.sql
---
Write `CREATE TABLE links` with `code VARCHAR(10) PRIMARY KEY`, `long_url TEXT NOT NULL`, `owner_id BIGINT`, `created_at TIMESTAMP NOT NULL`, `expires_at TIMESTAMP`; then an index `links_owner` on `(owner_id, created_at)`.
---starter
-- Snip schema
---rule
CREATE\s+TABLE\s+links\s*\(
`CREATE TABLE links`
---rule
code\s+VARCHAR\(\s*10\s*\)\s+PRIMARY\s+KEY
`code` primary key
---rule
long_url\s+TEXT\s+NOT\s+NULL
`long_url` required
---rule
owner_id\s+BIGINT
`owner_id`
---rule
created_at\s+TIMESTAMP\s+NOT\s+NULL
`created_at`
---rule
expires_at\s+TIMESTAMP
`expires_at`
---rule
CREATE\s+INDEX\s+links_owner\s+ON\s+links\s*\(\s*owner_id\s*,\s*created_at\s*\)
Index for "my links"
---solution
CREATE TABLE links (
  code        VARCHAR(10) PRIMARY KEY,
  long_url    TEXT NOT NULL,
  owner_id    BIGINT,
  created_at  TIMESTAMP NOT NULL,
  expires_at  TIMESTAMP
);
CREATE INDEX links_owner ON links (owner_id, created_at);
:::
