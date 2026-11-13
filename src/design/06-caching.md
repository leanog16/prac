---
id: design-caching
title: Caching
summary: Where caches live (browser, CDN, application, database), cache-aside, read-through, write-through and write-behind, TTLs and invalidation, eviction policies like LRU, hit ratio math, hot keys, cache stampedes and how to prevent them, and negative caching.
minutes: 40
---
> [!project] Snip, step 6: a cache in front of the database
> Snip's database could serve 10,000 lookups per second with enough replicas, but a cache does it with a fraction of the hardware and lower latency. This step adds a Redis cache for redirects, sized from lesson 2's estimate, and protects it from the classic failure modes.

## Caches everywhere

```
browser cache ─► CDN edge ─► load balancer ─► app (in-process cache) ─► Redis ─► database (buffer pool)
```

Each layer answers what it can and passes the rest on. The closer to the user, the faster, and the harder to invalidate.

## Cache-aside (lazy loading)

The most common pattern, and Snip's choice:

```python
def resolve(code: str) -> str | None:
    url = cache.get(f"link:{code}")
    if url is not None:
        return url                                  # hit: ~0.5 ms
    url = db.lookup(code)                           # miss: ~5 ms
    if url is not None:
        cache.set(f"link:{code}", url, ex=3600)     # keep for an hour
    return url
```

1. Read from the cache.
2. On a miss, read from the database and **populate** the cache.
3. On updates (a link is deleted or edited), **delete** the cache key, so the next read reloads it.

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

With 0.5 ms cache and 5 ms database: at 90% hits, ≈ 0.5 + 0.1 × 5 = **1.0 ms**; at 99%, ≈ **0.55 ms**. And database load drops by the same ratio: 10,000 req/s at 99% hits means only **100** queries per second reach the database.

## TTLs and invalidation

> "There are only two hard things in Computer Science: cache invalidation and naming things." (Phil Karlton)

- **TTL** (time to live) bounds staleness: even if an invalidation is missed, the entry dies after the TTL.
- **Explicit invalidation** on change keeps data fresh: delete the key after the database write commits.
- Add **jitter** to TTLs (3600 ± random 300 s) so entries created together don't all expire together.

For Snip, links almost never change, so a long TTL plus deletion on edit or expiry is ideal.

## Eviction: when the cache is full

| Policy | Evicts | Good for |
|---|---|---|
| LRU (least recently used) | the item untouched for longest | most workloads: recency predicts reuse |
| LFU (least frequently used) | the least-used item | stable popularity |
| TTL-based | expired items first | data with natural lifetimes |
| random | anything | surprisingly OK, very cheap |

Redis supports these via `maxmemory-policy` (e.g. `allkeys-lru`).

## Failure modes

- **Hot key**: one viral link gets 50,000 requests/s, all on one Redis node. Fixes: a small in-process cache in each app server for the hottest keys; replicating hot keys; CDN caching (lesson 4).
- **Cache stampede (thundering herd)**: a hot key expires and thousands of requests miss at once, all hitting the database. Fixes: a **lock** so only one request recomputes while others wait or serve stale; refresh hot keys **before** they expire; TTL jitter.
- **Penetration**: requests for codes that don't exist always miss and always hit the database (bots scanning `snip.ly/aaaaaaa`, `aaaaaab`…). Fix: **negative caching** (cache "not found" for a short TTL), plus rate limiting.
- **Cold start**: after a cache restart everything misses at once. Warm the cache gradually or keep replicas.

:::quiz
q: In cache-aside, what should happen when a link is deleted?
+ delete it from the database, then delete the cache key
- only delete it from the cache
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
q: Bots request millions of random codes that don't exist. Which technique protects the database?
+ negative caching ("not found" entries with a short TTL), plus rate limiting
- a longer TTL for existing keys
- write-through caching
- LFU eviction
why: Otherwise every nonexistent code is a guaranteed miss.
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
title: "Project 6: Snip's cache-aside lookup"
mode: code
lang: python
file: resolve.py
---
Write `resolve(code: str) -> str | None` using cache-aside with key `f"link:{code}"`: return the cached value on a hit; on a miss call `db.lookup(code)`; if found, store it with `cache.set(key, url, ex=3600 + random.randint(0, 300))` (TTL with jitter); if not found, store the string `"__missing__"` for **60** seconds (negative caching) and return `None`. A cached `"__missing__"` also returns `None`.
---starter
import random

from infra import cache, db
---rule
def\s+resolve\(\s*code\s*:\s*str\s*\)
The signature
---rule
key\s*=\s*f["']link:\{code\}["']
The cache key
---rule
cache\.get\(\s*key\s*\)
Read the cache first
---rule
["']__missing__["'][\s\S]*?return\s+None
A cached miss returns None
---rule
db\.lookup\(\s*code\s*\)
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


def resolve(code: str) -> str | None:
    key = f"link:{code}"
    cached = cache.get(key)
    if cached is not None:
        if cached == "__missing__":
            return None
        return cached
    url = db.lookup(code)
    if url is None:
        cache.set(key, "__missing__", ex=60)
        return None
    cache.set(key, url, ex=3600 + random.randint(0, 300))
    return url
:::

:::exercise
id: proj-design-06-load
level: 2
title: "Project 6b: database load after caching"
mode: answer
---
Snip serves 10,000 redirects per second with a 98% cache hit ratio. How many lookups per second reach the database?
---answer
200
---solution
200
:::
