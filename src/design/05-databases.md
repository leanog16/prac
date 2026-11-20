---
id: design-databases
title: Databases at scale
summary: Indexes and query plans, replication (leader-follower, synchronous vs asynchronous, replication lag), read replicas, partitioning and sharding strategies, choosing a shard key, consistent hashing, SQL vs NoSQL families, and CAP and PACELC in practice.
minutes: 45
---
> [!project] Taskboard, step 5: the data tier
> The app tier scales horizontally; the database is now the bottleneck and the single point of failure. Lesson 2 also showed Taskboard's tasks will outgrow one server (~55 TB in 5 years with copies). This step adds replicas for availability and read scaling, then decides how to **shard** the data.

## Indexes first

Before any distributed cleverness, make sure each query uses an **index**. Most databases store indexes as **B-trees**, sorted trees where finding a key takes a handful of steps even among billions of rows (the cost grows with the logarithm of the row count, written O(log n)). A missing index on a hot query turns it into a **full scan** of every row. `EXPLAIN` before a query shows the database's plan, including which index it uses.

Indexes cost write speed and storage, so index for real query patterns: Taskboard's board query uses `tasks(board_id, status, updated_at)` from lesson 3; "my tasks" uses `tasks(assignee_id, status)`. Nothing more until a real query needs it.

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

**Replication lag**: async replicas are usually milliseconds behind, sometimes seconds. That causes classic bugs: a user moves a task to `done` (written to the primary), the page reloads the board (read from a replica that hasn't caught up), and the task jumps back to `doing`. Fixes: **read-your-writes** (read your own recent data from the primary), or waiting for the replica to reach a given log position. Sticking to one replica alone does not guarantee read-your-writes after a primary write.

## Partitioning and sharding

When one primary can't handle the writes or hold the data, split the data across several databases (**shards**), each owning a subset of keys.

| Strategy | How | Good | Bad |
|---|---|---|---|
| range | workspaces 1–1,000,000 on shard 1, the next million on shard 2… | range scans are efficient | hot spots if keys are sequential (all new workspaces hit the last shard) |
| hash | `shard = hash(workspace_id) % N` | even spread | range queries hit every shard; changing N moves most keys |
| consistent hashing | keys and shards placed on a ring; each key goes to the next shard clockwise | adding a shard moves only ~1/N of keys | slightly more complex; use virtual nodes for balance |
| directory | a lookup table maps key → shard | fully flexible | the directory is a dependency and must be highly available |

### Choosing a shard key

The shard key decides everything:

- It must be present in (almost) every query, or queries must ask **every** shard ("scatter-gather").
- It must spread load evenly: no shard should get the "celebrity" traffic.
- Data that's queried together should share a shard.

For Taskboard, **`workspace_id` is the natural shard key**. Every board, task and comment belongs to exactly one workspace, almost every request is scoped to one ("board 12 of workspace 7"), and keeping a team's data together means joins and transactions stay inside a single shard. Millions of workspaces spread the load evenly.

The trade-offs: a giant enterprise workspace can become a **hot shard**, so the design keeps a small **directory** of exceptions that places the largest workspaces on dedicated shards. And a query across workspaces ("all tasks assigned to Ana in every workspace she belongs to") must ask every shard it might touch; Taskboard keeps it cheap by storing each user's workspace list and querying only those shards.

> [!plain] In plain English
> Sharding splits one giant table into many smaller ones on different machines. The shard key is the rule that decides which machine owns which rows, so choose a key that's in every hot query and spreads the load evenly.

## Consistent hashing, step by step

1. Hash each shard's name to positions on a ring of, say, 0–2³². For balance, give each shard many **virtual nodes**: hash `db-a#0`, `db-a#1`, `db-a#2`… so each shard appears at many scattered positions. (In Python, the f-string `f"{node}#{i}"` builds those names: the values of `node` and `i` replace the `{...}` parts.) A ring position is stored as a pair `(position, shard)`, and sorting a list of pairs sorts by the first element.
2. Hash the key to a position on the same ring.
3. Walk clockwise to the first shard position: that shard owns the key.
4. Adding a shard takes over only the keys between it and its predecessor: about 1/N of the data moves, instead of almost all of it with `hash % N`.

DynamoDB, Cassandra and many caches use this idea.

In Python, the ring is a **sorted list** of positions. The standard library's `bisect.bisect(sorted_list, x)` returns the index where `x` would be inserted to keep the list sorted, which is exactly the index of the first position **after** `x`, i.e. the next shard clockwise. Past the end of the list, `% len(...)` wraps around to index 0, closing the ring:

```python
import bisect

positions = [100, 400, 700]           # sorted ring positions
owners = ["db-a", "db-b", "db-c"]     # who sits at each position

def owner_of(key_position: int) -> str:
    i = bisect.bisect(positions, key_position) % len(positions)
    return owners[i]

owner_of(250)   # bisect → 1 → "db-b" (next position clockwise is 400)
owner_of(900)   # bisect → 3 → 3 % 3 = 0 → "db-a" (wraps around)
```

To turn a key into a ring position, hash it with a **stable** hash such as MD5: `int(hashlib.md5(key.encode()).hexdigest(), 16)` gives the same number for the same key on every machine, every run. (`key.encode()` turns the string into bytes, `.hexdigest()` returns the hash as hexadecimal text, and `int(..., 16)` reads that text as a base-16 number.) Python's built-in `hash()` can't be used for routing: it's randomized per process, so two servers would disagree.

## SQL vs NoSQL

| Family | Examples | Strengths | Fits |
|---|---|---|---|
| relational | PostgreSQL, MySQL | joins, transactions, constraints, flexible queries | most business data |
| key-value | DynamoDB, Redis | huge scale, predictable latency by key | sessions, caches, counters |
| document | MongoDB | flexible nested records | content, catalogs |
| wide-column | Cassandra, Bigtable | massive write throughput | time series, events |
| graph | Neo4j | relationship traversal | social graphs, recommendations |
| search | Elasticsearch/OpenSearch | full-text, faceting | search boxes, log analytics |

Taskboard's core (workspaces, boards, tasks, comments, permissions) is relational data with transactions ("move this task and record the activity together"), so it stays on a relational database, sharded by workspace. Its full-text task search goes to a search engine fed by events (lesson 7). Choose by access patterns and team skills, not fashion.

## CAP and PACELC

**CAP**: during a network **P**artition, a distributed store must choose between **C**onsistency (every read sees the latest write, or errors) and **A**vailability (every request gets a response, possibly stale). **PACELC** adds: **E**lse, in normal operation, it trades **L**atency against **C**onsistency.

For Taskboard: showing a board that is a second stale is far better than showing an error, so board **reads** favor availability. A **change** (moving a task) must not be accepted by two sides of a partition that disagree, so writes go to the workspace's primary and fail if it can't be reached: consistency for writes.

:::quiz
q: Why might a task jump back to its old column right after a user moves it, when boards are read from replicas?
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
q: Which is the best shard key for Taskboard's tasks?
+ the workspace id, which is in almost every query and keeps a team's data together
- created_at, for time-ordered data
- the task title
- the assignee's country
why: It matches the access pattern and spreads millions of workspaces evenly.
:::

:::quiz
q: During a network partition, Taskboard's board view chooses to show possibly-stale data rather than fail. In CAP terms it favors…
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
Taskboard's workspaces are spread over **4** shards with consistent hashing. You add a **5th** shard. Roughly what fraction of the workspaces move to the new shard? Answer as a fraction like `1/2`.
---answer
1/5
---answer
20%
---answer
0.2
---solution
1/5
---explain
With consistent hashing the new shard takes an equal share, about 1/N of the keys for N = 5 shards; nothing else moves.
:::

:::exercise
id: proj-design-05-lag
level: 3
title: "Project 5b: the task that jumped back"
mode: answer
---
A user moves a task to `done`; the board reloads from an async read replica and the task is back in `doing`. Name the consistency guarantee this user needs (three words, hyphenated or not).
---answer
read-your-writes
---answer
read your writes
---solution
read-your-writes
:::

:::exercise
id: proj-design-05-key
level: 2
title: "Project 5c: the shard key"
mode: answer
---
Which column should Taskboard's task data be sharded by: `id`, `workspace_id`, `assignee_id` or `updated_at`?
---answer
workspace_id
---solution
workspace_id
---explain
It's in almost every query and keeps each team's boards, tasks and comments on one shard.
:::
