---
id: design-boss
title: Boss round: case studies
summary: Full interview-style designs (a URL shortener end to end, a news feed, a chat system, a rate limiter service and a notification system), with the estimates, key decisions and trade-offs each one hinges on.
minutes: 60
---
## Snip, the whole design

Everything from the track, assembled:

```
users ─► GeoDNS ─► CDN (caches popular redirects, 5 min)
                    │
             API gateway (TLS, auth, rate limits)
             │                         │
   redirect service (stateless, N×AZ)   links/accounts modular monolith
      │        │                          │            │
   Redis cache  read replica            primary DB    outbox ─► Kafka "links.*"
   (LRU, TTL+jitter, negative caching)  (sharded by code when needed)
      │
   publish link.clicked (circuit breaker, best effort) ─► Kafka "clicks" ─► stream counters ─► dashboard
                                                                       └─► S3 (by date) ─► nightly reports
```

Numbers that justify it: 40 writes/s, 4k reads/s average, 10k+ peak; 6 B links ≈ 1.2 TB over 5 years; a 2–4 GB hot cache absorbs most reads; 99.99% for redirects.

## Five more designs in brief

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

### Web crawler

- A URL frontier (priority queues per host for politeness), fetchers, a parser, dedup by URL and content hash (Bloom filter), storage for pages.
- Politeness (robots.txt, per-host rate limits) is a requirement, not an optimization.

## How you'll be evaluated

Clear requirements and estimates, a simple design first, then deliberate scaling of the actual bottlenecks, explicit trade-offs, and failure handling. Not memorized diagrams.

:::exercise
id: proj-design-10-celebrity
level: 3
title: "Project 10: the celebrity problem"
mode: answer
---
In a fan-out-on-write news feed, one account with 50 million followers posts. How many feed-list writes does that single post cause?
---answer
50000000
---answer
50,000,000
---answer
50 million
---solution
50000000
---explain
That's why large systems switch to fan-out-on-read for celebrity accounts.
:::

:::exercise
id: proj-design-10-shard-chat
level: 3
title: "Project 10b: chat partition key"
mode: answer
---
A chat system must return the messages of one conversation, in order, quickly. Which field should messages be partitioned by: `sender_id`, `conversation_id` or `timestamp`?
---answer
conversation_id
---solution
conversation_id
:::

:::exercise
id: proj-design-10-fail-mode
level: 3
title: "Project 10c: fail open or closed?"
mode: answer
---
Snip's rate limiter (in Redis) becomes unreachable. For the **redirect** endpoint, where availability matters most, should the limiter fail `open` (allow requests) or `closed` (deny them)?
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
title: "Project 10d: chat estimates"
mode: answer
---
A chat app has 50 million daily active users who each send 40 messages a day. Roughly how many messages per second on **average**? (Use 10⁵ seconds per day.)
---answer
20000
---answer
20,000
---solution
20000
---explain
50 × 10⁶ × 40 = 2 × 10⁹ messages/day ÷ 10⁵ s = 2 × 10⁴.
:::

:::exercise
id: proj-design-10-final
level: 4
title: "Project 10e: Snip's final design doc"
mode: code
lang: yaml
file: snip-design.yaml
---
Summarize Snip's design as YAML with these top-level keys: `estimates` (with `writes_per_sec: 40`, `reads_per_sec_peak: 10000`, `storage_5y_tb: 1.2`), `components` (a list including `cdn`, `api gateway`, `redirect service`, `redis cache`, `primary database`, `read replica` and `kafka`), `short_codes: random base62, 7 chars`, `shard_key: code`, `redirect_status: 302`, and `analytics: async via kafka`.
---starter
# Snip design summary
---rule
^estimates:\s*\n
`estimates`
---rule
writes_per_sec:\s*40\b
Writes per second
---rule
reads_per_sec_peak:\s*10000\b
Peak reads
---rule
storage_5y_tb:\s*1\.2\b
Storage
---rule
^components:\s*\n
`components`
---rule
-\s+cdn[\s\S]*-\s+api gateway|-\s+api gateway[\s\S]*-\s+cdn
CDN and gateway
---rule
-\s+redirect service
Redirect service
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
^short_codes:\s*["']?random base62, 7 chars["']?\s*$
Short codes
---rule
^shard_key:\s*["']?code["']?\s*$
Shard key
---rule
^redirect_status:\s*302\s*$
302
---rule
^analytics:\s*["']?async via kafka["']?\s*$
Analytics
---solution
estimates:
  writes_per_sec: 40
  reads_per_sec_peak: 10000
  storage_5y_tb: 1.2
components:
  - cdn
  - api gateway
  - redirect service
  - redis cache
  - primary database
  - read replica
  - kafka
short_codes: random base62, 7 chars
shard_key: code
redirect_status: 302
analytics: async via kafka
:::
