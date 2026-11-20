---
id: design-boss
title: Boss round: case studies
summary: Taskboard's complete design end to end, then five more interview-style designs (a news feed, a chat system, a rate limiter service, a notification system and a URL shortener), with the estimates, key decisions and trade-offs each one hinges on.
minutes: 60
---
> [!project] Taskboard, final step: the complete design
> Bring Taskboard's requirements, estimates and architecture together. The Project exercises apply the case studies below to Taskboard and finish with a one-page design summary in `docs/design/`.

## Taskboard, the whole design

Everything from the track, assembled:

```
browsers/apps ─► GeoDNS ─► CDN (static assets only)
                            │
                     API gateway (TLS, auth, per-token rate limits)
                     │                               │
      app tier: modular monolith (stateless, N per AZ)      realtime service (WebSockets)
      │          │              │                                  ▲
   Redis cache   primary DBs    outbox ─► Kafka "task-events" ─────┤ (keyed by board_id)
   (board:{id},  sharded by     (one transaction                   ├─► notifications (breaker around email)
    TTL+jitter,  workspace_id,   with each change)                 ├─► search indexer
    negative     + read replicas)                                  └─► stream counters + S3 ─► reports
    caching)
```

Numbers that justify it: 1,000 writes/s and 10,000 reads/s on average, 3k and 30k at peak; ~18 TB of tasks in 5 years (~55 TB with copies), hence sharding; a ~20 GB hot cache absorbs most board loads; 99.95% availability.

One more number worth checking is **realtime fan-out**: every change is pushed to everyone who has that board open, so pushes per second = changes per second × average viewers per board. At 3,000 changes/s and 8 viewers each, the realtime service sends 24,000 messages a second, which is why it scales on its own.

## Six more designs in brief

### News feed (social timeline)

- **Key question**: build feeds on **write** (fan-out: push each new post into followers' feed lists) or on **read** (pull posts from everyone followed at view time)?
- Fan-out on write makes reads fast but celebrities with 50 M followers make writes explode. Common answer: **hybrid**: fan out for normal accounts, pull at read time for celebrity accounts, merge.
- Feed lists in a cache (Redis sorted sets by time), posts in a key-value store, media on a CDN.

### Chat system

- **WebSockets** to connection servers; a mapping of user → connection server (in Redis).
- Messages stored per conversation, **partitioned by conversation id**, ordered by a per-conversation sequence number.
- Offline users get push notifications; delivery and read receipts are just more events.
- Hard parts: ordering, delivery guarantees across reconnects (client-side message ids for idempotency), group chats' fan-out.

### Rate limiter as a service

- Token bucket or sliding window counters per key (user, IP, API key).
- Counters in Redis with atomic Lua scripts; local in-memory pre-checks to reduce Redis calls.
- Decide **fail open** (allow on limiter failure: availability) or **fail closed** (deny: protection), per endpoint.

### Notification system

- Producers publish "notify user X about Y" events to a queue.
- Workers apply user preferences and quiet hours, deduplicate, render templates, and call channel providers (email, SMS, push), each behind a circuit breaker with retries.
- Dead-letter queue + alarm for failures; per-provider rate limits.

### URL shortener

- Turn a long URL into `sho.rt/aZ3kQ9b` and redirect anyone who opens it.
- Short codes: random base62 with a collision check, or a pre-generated pool (lesson 3). The hot query is code → URL by primary key, so the code is also the natural shard key.
- Reads dwarf writes (often 100:1), so a cache and CDN do most of the work. Redirect with **302** (temporary) rather than **301** (permanent): browsers cache a 301 forever and never ask again, which would break click counting and link expiry.

### Web crawler

- A URL frontier (priority queues per host for politeness), fetchers, a parser, dedup by URL and content hash (Bloom filter), storage for pages.
- Politeness (robots.txt, per-host rate limits) is a requirement, not an optimization.

## How you'll be evaluated

Clear requirements and estimates, a simple design first, then deliberate scaling of the actual bottlenecks, explicit trade-offs, and failure handling. Not memorized diagrams.

:::exercise
id: proj-design-10-celebrity
level: 3
title: "Project 10: the giant workspace"
mode: answer
---
Taskboard adds a workspace announcement feed built with fan-out on write (see "News feed" above). A company workspace has 40,000 members. How many feed-list writes does a single announcement cause?
---answer
40000
---answer
40,000
---solution
40000
---explain
One write per member's feed. That's why very large audiences switch to fan-out on read.
:::

:::exercise
id: proj-design-10-shard-chat
level: 3
title: "Project 10b: comment partition key"
mode: answer
---
A task's comment thread works like a chat conversation: it must return the comments of one task, in order, quickly. Which field should comments be partitioned by: `author_id`, `task_id` or `created_at`?
---answer
task_id
---solution
task_id
---explain
Like `conversation_id` for chat: everything one query needs lives in one partition, in order.
:::

:::exercise
id: proj-design-10-fail-mode
level: 3
title: "Project 10c: fail open or closed?"
mode: answer
---
Taskboard's rate limiter (in Redis) becomes unreachable. For the **board-loading** endpoint, where availability matters most, should the limiter fail `open` (allow requests) or `closed` (deny them)?
---answer
open
---answer
fail open
---solution
open
:::

:::exercise
id: proj-design-10-qps
level: 4
title: "Project 10d: realtime fan-out"
mode: answer
---
At peak Taskboard makes 3,000 task changes per second, and each changed board is open in **8** browsers on average. How many WebSocket messages per second does the realtime service push?
---answer
24000
---answer
24,000
---solution
24000
---explain
Every change goes to every viewer of its board: 3,000 × 8 = 24,000 pushes per second.
:::

:::exercise
id: proj-design-10-final
level: 4
title: "Project 10e: Taskboard's design summary"
mode: code
lang: yaml
file: design.yaml
path: docs/design/design.yaml
---
Summarize Taskboard's design as YAML with these top-level keys:

- `estimates`, a map with `writes_per_sec: 1000`, `reads_per_sec_peak: 30000` and `storage_5y_tb: 18`;
- `components`, a list including `cdn`, `api gateway`, `app tier`, `realtime service`, `redis cache`, `primary database`, `read replica` and `kafka`;
- `shard_key: workspace_id`;
- `task_ids: snowflake`;
- `cache: cache-aside, delete on change`;
- `events: outbox to kafka, keyed by board_id`.
---starter
# Taskboard design summary
---hint
`estimates:` and `components:` each go on their own line with their contents indented under them; the other four are single `key: value` lines at the left margin.
---hint
Values containing a comma are fine unquoted in YAML, as long as there's no `: ` inside them.
---rule
^estimates:\s*\n
`estimates`
---rule
^\s+writes_per_sec:\s*1000\b
Writes per second
---rule
^\s+reads_per_sec_peak:\s*30000\b
Peak reads
---rule
^\s+storage_5y_tb:\s*18\b
Storage
---rule
^components:\s*\n
`components`
---rule
-\s+cdn\s*$
CDN
---rule
-\s+api gateway
Gateway
---rule
-\s+app tier
App tier
---rule
-\s+realtime service
Realtime service
---rule
-\s+redis cache
Cache
---rule
-\s+primary database
Primary
---rule
-\s+read replica
Replica
---rule
-\s+kafka
Kafka
---rule
^shard_key:\s*["']?workspace_id["']?\s*$
Shard key
---rule
^task_ids:\s*["']?snowflake["']?\s*$
Task ids
---rule
^cache:\s*["']?cache-aside, delete on change["']?\s*$
Cache strategy
---rule
^events:\s*["']?outbox to kafka, keyed by board_id["']?\s*$
Events
---solution
estimates:
  writes_per_sec: 1000
  reads_per_sec_peak: 30000
  storage_5y_tb: 18
components:
  - cdn
  - api gateway
  - app tier
  - realtime service
  - redis cache
  - primary database
  - read replica
  - kafka
shard_key: workspace_id
task_ids: snowflake
cache: cache-aside, delete on change
events: outbox to kafka, keyed by board_id
:::
