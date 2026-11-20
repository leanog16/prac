---
id: design-caching
title: Caching
summary: Where caches live (browser, CDN, application, database), cache-aside, read-through, write-through and write-behind, TTLs and invalidation, eviction policies like LRU, hit ratio math, hot keys, cache stampedes and how to prevent them, and negative caching.
minutes: 40
---
> [!project] Taskboard, step 6: a cache in front of the database
> Board loads peak at 30,000 per second. Replicas could serve that, but a cache does it with a fraction of the hardware and lower latency. This step adds a Redis cache of whole boards, sized from lesson 2's estimate (20 GB), keeps it fresh when tasks change, and protects it from the classic failure modes.

## Caches everywhere

```
browser cache ─► CDN edge ─► load balancer ─► app (in-process cache) ─► Redis ─► database (buffer pool)
```

Each layer answers what it can and passes the rest on. The closer to the user, the faster, and the harder to invalidate.

## Cache-aside (lazy loading)

The most common pattern, and Taskboard's choice. `cache` is a Redis client: `cache.get(key)` returns the stored value or `None`, `cache.set(key, value, ex=seconds)` stores a value that expires after `ex` seconds, and `cache.delete(key)` removes it.

```python
def load_board(board_id: int) -> dict | None:
    key = f"board:{board_id}"
    board = cache.get(key)
    if board is not None:
        return board                          # hit: ~0.5 ms
    board = db.load_board(board_id)           # miss: ~10 ms, several queries
    if board is not None:
        cache.set(key, board, ex=3600)        # keep for an hour
    return board


def move_task(task_id: int, board_id: int, status: str) -> None:
    db.update_status(task_id, status)         # 1. the database is the source of truth
    cache.delete(f"board:{board_id}")         # 2. then drop the stale copy
```

1. Read from the cache.
2. On a miss, read from the database and **populate** the cache.
3. On every change to a board's tasks, **delete** that board's key after the database write, so the next read reloads it.

Only data that's actually requested gets cached, and the cache can be lost entirely without losing data, because the database is the source of truth.

| Pattern | Writes go to | Pros | Cons |
|---|---|---|---|
| cache-aside | DB; app invalidates cache | simple, resilient | first read is a miss; brief staleness possible |
| read-through | cache loads from DB itself | app code simpler | needs a cache that knows the DB |
| write-through | cache and DB together | cache always fresh | every write pays twice; caches unread data |
| write-behind | cache now, DB later | very fast writes | data loss if the cache dies before flushing |

> [!plain] In plain English
> A cache is a small, fast notebook of recent answers. Check the notebook first; if the answer isn't there, look it up the slow way and write it down for next time.

## Hit ratio is everything

Average latency = hit ratio × cache latency + miss ratio × (cache + DB latency).

The cache is always checked, so its latency is paid on every request; the database is added only on misses. With a 0.5 ms cache and 5 ms database: at 90% hits, ≈ 0.5 + 0.1 × 5 = **1.0 ms**; at 99%, ≈ **0.55 ms**. And database load drops by the same ratio: 10,000 req/s at 99% hits means only 1% of them, **100** queries per second, reach the database.

Write-heavy data lowers the hit ratio: every change deletes a board's entry, so a board edited constantly is reloaded often. Taskboard's 10:1 read:write ratio still leaves most loads as hits.

## TTLs and invalidation

> "There are only two hard things in Computer Science: cache invalidation and naming things." (Phil Karlton)

- **TTL** (time to live) bounds staleness: even if an invalidation is missed, the entry dies after the TTL.
- **Explicit invalidation** on change keeps data fresh: delete the key after the database write commits.
- Add **jitter** to TTLs (3600 ± random 300 s) so entries created together don't all expire together.

For Taskboard, boards change often, so explicit deletion on every change does the real work and the one-hour TTL is the safety net. Jitter is added with `random.randint(0, 300)`, which returns a random whole number from 0 to 300 inclusive: `ex=3600 + random.randint(0, 300)`.

## Eviction: when the cache is full

| Policy | Evicts | Good for |
|---|---|---|
| LRU (least recently used) | the item untouched for longest | most workloads: recency predicts reuse |
| LFU (least frequently used) | the least-used item | stable popularity |
| TTL-based | expired items first | data with natural lifetimes |
| random | anything | surprisingly OK, very cheap |

Redis supports these via `maxmemory-policy` (e.g. `allkeys-lru`).

### How an LRU cache works

An LRU cache keeps items in order of last use. Python's `collections.OrderedDict` is a dictionary that remembers insertion order and can reorder it, which makes LRU short:

- `d.move_to_end(key)` moves an existing key to the end (the "most recently used" end);
- `d.popitem(last=False)` removes and returns the item at the **front**: the least recently used one.

```python
from collections import OrderedDict

d = OrderedDict()
d["a"] = 1; d["b"] = 2; d["c"] = 3   # order: a, b, c
d.move_to_end("a")                    # order: b, c, a   ("a" was just used)
d.popitem(last=False)                 # removes "b", the least recently used
```

So an LRU `get` moves the key to the end; a `put` stores the value, moves it to the end, and if the cache is now over capacity, pops from the front.

## Failure modes

- **Hot key**: a company-wide board everyone opens at 9 a.m. gets 20,000 requests/s, all on one Redis node. Fixes: a small in-process cache in each app server for the hottest keys (for a second or two); replicating hot keys to several nodes.
- **Cache stampede (thundering herd)**: a hot key expires and thousands of requests miss at once, all hitting the database. Fixes: a **lock** so only one request recomputes while others wait or serve stale; refresh hot keys **before** they expire; TTL jitter.
- **Penetration**: requests for boards that don't exist always miss and always hit the database (a buggy integration polling a deleted board, bots trying ids 1, 2, 3…). Fix: **negative caching**: store a marker such as the string `"__missing__"` for a short TTL, and treat a cached marker as "not found"; plus rate limiting.
- **Cold start**: after a cache restart everything misses at once. Warm the cache gradually or keep replicas.

:::quiz
q: In cache-aside, what should happen when a task on board 12 moves to `done`?
+ update the database, then delete the `board:12` cache key
- only update the cache
- update the cache and never touch the database
- nothing; the TTL will handle it
why: The database is the source of truth; the cache entry is removed so it can't serve stale data.
:::

:::quiz
q: Cache latency 1 ms, database 10 ms, hit ratio 90%. Approximate average latency?
- 1 ms
+ 2 ms
- 5.5 ms
- 10 ms
why: 1 + 0.1 × 10 = 2 ms.
:::

:::quiz
q: A hot key expires and thousands of requests hit the database at once. What is this called?
- cache penetration
+ a cache stampede (thundering herd)
- a hot shard
- write-behind
why: Prevent it with locking, early refresh or TTL jitter.
:::

:::quiz
q: A broken integration requests thousands of board ids that don't exist. Which technique protects the database?
+ negative caching ("not found" entries with a short TTL), plus rate limiting
- a longer TTL for existing keys
- write-through caching
- LFU eviction
why: Otherwise every nonexistent id is a guaranteed miss.
:::

:::exercise
id: dc-lru
level: 4
title: An LRU cache
mode: code
lang: python
file: lru.py
---
Implement `LRUCache` with an `OrderedDict`: `get(key)` returns `None` if missing, otherwise moves the key to the end (`move_to_end`) and returns its value; `put(key, value)` stores it, moves it to the end, and if the size exceeds `capacity`, removes the **oldest** item with `popitem(last=False)`.
---starter
from collections import OrderedDict


class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.data = OrderedDict()
---rule
def\s+get\(\s*self\s*,\s*key\s*\)
`get(self, key)`
---rule
if\s+key\s+not\s+in\s+self\.data\s*:\s*\n\s+return\s+None
Missing → None
---rule
self\.data\.move_to_end\(\s*key\s*\)[\s\S]*return\s+self\.data\[\s*key\s*\]
Mark as recently used, then return
---rule
def\s+put\(\s*self\s*,\s*key\s*,\s*value\s*\)
`put(self, key, value)`
---rule
self\.data\[\s*key\s*\]\s*=\s*value
Store it
---rule
if\s+len\(\s*self\.data\s*\)\s*>\s*self\.capacity\s*:\s*\n\s+self\.data\.popitem\(\s*last\s*=\s*False\s*\)
Evict the least recently used
---solution
from collections import OrderedDict


class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.data = OrderedDict()

    def get(self, key):
        if key not in self.data:
            return None
        self.data.move_to_end(key)
        return self.data[key]

    def put(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        if len(self.data) > self.capacity:
            self.data.popitem(last=False)
:::

:::exercise
id: dc-predict-lru
level: 3
title: Predict: LRU eviction
mode: answer
---
An LRU cache with capacity 2 receives: `put(a)`, `put(b)`, `get(a)`, `put(c)`. Which key was evicted?
---answer
b
---solution
b
---explain
`get(a)` made `a` the most recently used, so `b` was the least recently used when `c` arrived.
:::

:::exercise
id: proj-design-06-aside
level: 3
title: "Project 6: cache-aside board loads"
mode: code
lang: python
file: boards_cache.py
path: docs/design/boards_cache.py
---
Write `load_board(board_id: int)` using cache-aside with the key `f"board:{board_id}"`:

- read `cache.get(key)`; a cached `"__missing__"` returns `None`; any other cached value is returned;
- on a miss, call `db.load_board(board_id)`;
- if that returns `None`, store `"__missing__"` with `ex=60` (negative caching) and return `None`;
- otherwise store the board with `ex=3600 + random.randint(0, 300)` (a TTL with jitter) and return it.
---starter
import random

from infra import cache, db
---hint
Start from the lesson's `load_board`, then add the two `"__missing__"` branches.
---rule
def\s+load_board\(\s*board_id\s*:\s*int\s*\)
The signature
---rule
key\s*=\s*f["']board:\{board_id\}["']
The cache key
---rule
cache\.get\(\s*key\s*\)
Read the cache first
---rule
["']__missing__["'][\s\S]*?return\s+None
A cached miss returns None
---rule
db\.load_board\(\s*board_id\s*\)
Fall back to the database
---rule
cache\.set\(\s*key\s*,\s*\w+\s*,\s*ex\s*=\s*3600\s*\+\s*random\.randint\(\s*0\s*,\s*300\s*\)\s*\)
Populate with a jittered TTL
---rule
cache\.set\(\s*key\s*,\s*["']__missing__["']\s*,\s*ex\s*=\s*60\s*\)
Negative caching for 60 s
---solution
import random

from infra import cache, db


def load_board(board_id: int):
    key = f"board:{board_id}"
    cached = cache.get(key)
    if cached is not None:
        if cached == "__missing__":
            return None
        return cached
    board = db.load_board(board_id)
    if board is None:
        cache.set(key, "__missing__", ex=60)
        return None
    cache.set(key, board, ex=3600 + random.randint(0, 300))
    return board
:::

:::exercise
id: proj-design-06-invalidate
level: 2
title: "Project 6b: keep the cache fresh"
mode: code
lang: python
file: boards_cache.py
path: docs/design/move_task.py
---
Write `move_task(task_id: int, board_id: int, status: str)` that first calls `db.update_status(task_id, status)` and **then** deletes the board's cache entry with `cache.delete(f"board:{board_id}")`.
---starter
from infra import cache, db
---rule
def\s+move_task\(\s*task_id\s*:\s*int\s*,\s*board_id\s*:\s*int\s*,\s*status\s*:\s*str\s*\)
The signature
---rule
db\.update_status\(\s*task_id\s*,\s*status\s*\)[\s\S]*cache\.delete\(\s*f["']board:\{board_id\}["']\s*\)
Database first, then delete the cache key
---solution
from infra import cache, db


def move_task(task_id: int, board_id: int, status: str):
    db.update_status(task_id, status)
    cache.delete(f"board:{board_id}")
---explain
Deleting after the write means the next read reloads the new state. Deleting first would let a concurrent read put the old board back into the cache before the write lands.
:::

:::exercise
id: proj-design-06-load
level: 2
title: "Project 6c: database load after caching"
mode: answer
---
Taskboard serves 30,000 board loads per second at peak with a 95% cache hit ratio. How many board loads per second reach the database?
---answer
1500
---answer
1,500
---solution
1500
---explain
5% miss: 0.05 × 30,000 = 1,500.
:::
