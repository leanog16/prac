---
id: design-databases
title: Databases at scale
summary: Indexes and query plans, replication (leader-follower, synchronous vs asynchronous, replication lag), read replicas, partitioning and sharding strategies, choosing a shard key, consistent hashing, SQL vs NoSQL families, and CAP and PACELC in practice.
minutes: 45
---
> [!project] Snip, step 5: the data tier
> The app tier scales horizontally; the database is now the bottleneck and the single point of failure. This step adds replicas for availability and read scaling, then decides how Snip would **shard** when one primary isn't enough.

## Indexes first

Before any distributed cleverness, make sure each query uses an **index**. A lookup by primary key on a B-tree index is O(log n): a handful of page reads even with billions of rows. A missing index on a hot query turns it into a full scan. Check plans with `EXPLAIN`.

Indexes cost write speed and storage, so index for real query patterns: Snip needs `links(code)` (the primary key) and `links(owner_id, created_at)`, nothing more.

## Replication

```
            writes
app ───────────────► primary (leader)
  │                     │  replication stream
  │ reads               ▼
  └────────────► replica 1, replica 2   (followers)
```

| | Synchronous | Asynchronous |
|---|---|---|
| a write is acknowledged | after replicas confirm it | as soon as the primary has it |
| on primary failure | no data loss | recent writes may be lost |
| latency | higher (waits for replicas) | lower |
| common setup | one sync standby for failover, others async | read replicas |

**Replication lag**: async replicas are usually milliseconds behind, sometimes seconds. That causes classic bugs: a user creates a link (written to the primary), is redirected to "my links" (read from a replica that hasn't caught up), and the new link is missing. Fixes: **read-your-writes** (read your own recent data from the primary), sticky sessions to one replica, or waiting for the replica to reach a given log position.

## Partitioning and sharding

When one primary can't handle the writes or hold the data, split the data across several databases (**shards**), each owning a subset of keys.

| Strategy | How | Good | Bad |
|---|---|---|---|
| range | codes `0…`–`9…` on shard 1, `a…`–`m…` on shard 2… | range scans are efficient | hot spots if keys are sequential (all new rows hit the last shard) |
| hash | `shard = hash(code) % N` | even spread | range queries hit every shard; changing N moves most keys |
| consistent hashing | keys and shards placed on a ring; each key goes to the next shard clockwise | adding a shard moves only ~1/N of keys | slightly more complex; use virtual nodes for balance |
| directory | a lookup table maps key → shard | fully flexible | the directory is a dependency and must be highly available |

### Choosing a shard key

The shard key decides everything:

- It must be present in (almost) every query, or queries must ask **every** shard ("scatter-gather").
- It must spread load evenly: no shard should get the "celebrity" traffic.
- Data that's queried together should share a shard.

For Snip, the hot query is "code → URL", so **`code` is the natural shard key** and random codes spread perfectly. The "my links" page (by `owner_id`) then has to scatter-gather, or use a secondary index stored separately, partitioned by `owner_id`. That's an acceptable trade-off for a low-traffic dashboard.

> [!plain] In plain English
> Sharding splits one giant table into many smaller ones on different machines. The shard key is the rule that decides which machine owns which rows, so choose a key that's in every hot query and spreads the load evenly.

## Consistent hashing, step by step

1. Hash each shard's name to positions on a ring of, say, 0–2³² (use several **virtual nodes** per shard for balance).
2. Hash the key to a position on the same ring.
3. Walk clockwise to the first shard position: that shard owns the key.
4. Adding a shard takes over only the keys between it and its predecessor: about 1/N of the data moves, instead of almost all of it with `hash % N`.

DynamoDB, Cassandra and many caches use this idea.

## SQL vs NoSQL

| Family | Examples | Strengths | Fits |
|---|---|---|---|
| relational | PostgreSQL, MySQL | joins, transactions, constraints, flexible queries | most business data |
| key-value | DynamoDB, Redis | huge scale, predictable latency by key | sessions, Snip's code → URL |
| document | MongoDB | flexible nested records | content, catalogs |
| wide-column | Cassandra, Bigtable | massive write throughput | time series, events |
| graph | Neo4j | relationship traversal | social graphs, recommendations |
| search | Elasticsearch/OpenSearch | full-text, faceting | search boxes, log analytics |

Snip's core is a perfect key-value workload; a managed key-value store (DynamoDB) or a sharded relational database both work. Choose by access patterns and team skills, not fashion.

## CAP and PACELC

**CAP**: during a network **P**artition, a distributed store must choose between **C**onsistency (every read sees the latest write, or errors) and **A**vailability (every request gets a response, possibly stale). **PACELC** adds: **E**lse, in normal operation, it trades **L**atency against **C**onsistency.

For Snip: a redirect is far better served stale than not at all, so prefer **availability** for reads. A just-created link failing for a second during a partition is acceptable.

:::quiz
q: Why might a user not see a link they just created when "my links" reads from a replica?
+ asynchronous replication lag: the replica hasn't received the write yet
- the primary dropped the write
- indexes weren't updated
- caching at the CDN
why: Read-your-writes consistency needs extra care with async replicas.
:::

:::quiz
q: What is the main drawback of `shard = hash(key) % N` when N changes?
+ most keys map to a different shard, so most data must move
- keys become unevenly distributed
- range queries become faster
- it requires a directory
why: Consistent hashing limits movement to about 1/N of the keys.
:::

:::quiz
q: Which is the best shard key for Snip's redirect table?
+ the short code, which is in every redirect lookup and spreads evenly
- created_at, for time-ordered data
- the owner's country
- the long URL's domain
why: It matches the hot query and random codes avoid hot spots.
:::

:::quiz
q: During a network partition, Snip's redirect service chooses to serve possibly-stale data rather than fail. In CAP terms it favors…
- consistency
+ availability
- partition intolerance
- latency only
why: Returning a (possibly stale) answer is the availability choice.
:::

:::exercise
id: dd-hash-shard
level: 2
title: Hash sharding
mode: code
lang: python
file: shards.py
---
Write `shard_for(key: str, shards: int) -> int` that returns `int(hashlib.md5(key.encode()).hexdigest(), 16) % shards`. (Python's built-in `hash()` changes between processes, so it can't be used for routing.)
---starter
import hashlib
---rule
def\s+shard_for\(\s*key\s*:\s*str\s*,\s*shards\s*:\s*int\s*\)\s*->\s*int\s*:
The signature
---rule
hashlib\.md5\(\s*key\.encode\(\s*\)\s*\)\.hexdigest\(\s*\)
A stable hash
---rule
int\(\s*hashlib\.md5\(\s*key\.encode\(\s*\)\s*\)\.hexdigest\(\s*\)\s*,\s*16\s*\)\s*%\s*shards
Modulo the shard count
---rule
!\bhash\(\s*key\s*\)
Not the built-in `hash()`
---solution
import hashlib


def shard_for(key: str, shards: int) -> int:
    return int(hashlib.md5(key.encode()).hexdigest(), 16) % shards
:::

:::exercise
id: dd-ring
level: 4
title: A consistent-hash ring
mode: code
lang: python
file: ring.py
---
Complete `Ring`: in `__init__`, for each node and each `i in range(vnodes)`, add `(h(f"{node}#{i}"), node)` to `self.points`, then sort `self.points` and build `self.keys = [p[0] for p in self.points]`. In `node_for(key)`, find `i = bisect.bisect(self.keys, h(key)) % len(self.keys)` and return `self.points[i][1]`.
---starter
import bisect
import hashlib


def h(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16)


class Ring:
    def __init__(self, nodes: list[str], vnodes: int = 100):
        self.points = []
        self.keys = []

    def node_for(self, key: str) -> str:
        ...
---rule
for\s+node\s+in\s+nodes\s*:\s*\n\s+for\s+i\s+in\s+range\(\s*vnodes\s*\)\s*:
Virtual nodes per node
---rule
self\.points\.append\(\s*\(\s*h\(\s*f["']\{node\}#\{i\}["']\s*\)\s*,\s*node\s*\)\s*\)
Place each virtual node on the ring
---rule
self\.points\.sort\(\s*\)|self\.points\s*=\s*sorted\(\s*self\.points\s*\)
Sort the ring
---rule
self\.keys\s*=\s*\[\s*p\[\s*0\s*\]\s+for\s+p\s+in\s+self\.points\s*\]
Positions for searching
---rule
bisect\.bisect\(\s*self\.keys\s*,\s*h\(\s*key\s*\)\s*\)\s*%\s*len\(\s*self\.keys\s*\)
Walk clockwise, wrapping around
---rule
return\s+self\.points\[\s*\w+\s*\]\[\s*1\s*\]
Return the owning node
---solution
import bisect
import hashlib


def h(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16)


class Ring:
    def __init__(self, nodes: list[str], vnodes: int = 100):
        self.points = []
        for node in nodes:
            for i in range(vnodes):
                self.points.append((h(f"{node}#{i}"), node))
        self.points.sort()
        self.keys = [p[0] for p in self.points]

    def node_for(self, key: str) -> str:
        i = bisect.bisect(self.keys, h(key)) % len(self.keys)
        return self.points[i][1]
:::

:::exercise
id: proj-design-05-move
level: 3
title: "Project 5: how much data moves?"
mode: answer
---
Snip's links are spread over **4** shards with consistent hashing. You add a **5th** shard. Roughly what fraction of the keys move to the new shard? Answer as a fraction like `1/2`.
---answer
1/5
---answer
20%
---answer
0.2
---solution
1/5
:::

:::exercise
id: proj-design-05-lag
level: 3
title: "Project 5b: the missing link"
mode: answer
---
After creating a link, a user is redirected to "My links", served from an async read replica, and the new link isn't there yet. Name the consistency guarantee you need for this page (three words, hyphenated or not).
---answer
read-your-writes
---answer
read your writes
---solution
read-your-writes
:::
