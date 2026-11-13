---
id: design-async
title: Queues, events & stream processing
summary: Synchronous vs asynchronous work, message queues and their delivery guarantees, pub/sub and event-driven architecture, Kafka-style logs with partitions and consumer groups, idempotent consumers, the transactional outbox, backpressure, and batch vs stream analytics.
minutes: 40
---
> [!project] Snip, step 7: click analytics
> Every redirect is a click Snip must count: by link, by day, by country, by referrer. That's up to 10,000 events a second. Writing a row per click in the request path would slow every redirect and hammer the database. This step designs an asynchronous analytics pipeline instead.

## Do it later

A request should only do the work the user **waits for**. Everything else (counting clicks, sending emails, resizing images, updating search indexes) can happen **asynchronously**:

```
redirect request ─► look up URL ─► publish {"code", "ts", "country", "referrer"} ─► 302   (fast)
                                          │
                                   message broker
                                          │
                         analytics consumers (at their own pace) ─► aggregates
```

Benefits: lower latency for users, the redirect keeps working when analytics is down, and consumers can be scaled, paused or replayed independently.

## Queues vs pub/sub vs logs

| Model | Each message goes to | Examples | Use |
|---|---|---|---|
| **queue** | **one** consumer of a pool (competing consumers) | SQS, RabbitMQ queues | jobs: "send this email" |
| **pub/sub** | **every** subscriber | SNS, Google Pub/Sub, RabbitMQ fanout | events many services care about |
| **log** (stream) | consumers read at their own offset; messages are **retained** and replayable | Kafka, Kinesis, Redpanda | high-volume event streams, analytics, event sourcing |

### Kafka-style logs in one picture

```
topic "clicks", 3 partitions (ordered within a partition)
p0: e1 e4 e7 e10 …     ◄── consumer A (group "analytics")
p1: e2 e5 e8 …         ◄── consumer B (group "analytics")
p2: e3 e6 e9 …         ◄── consumer C (group "analytics")
                          and independently, group "fraud" reads all partitions at its own offsets
```

- A message's **key** chooses its partition (`hash(key) % partitions`). Same key → same partition → **ordered** for that key. Snip keys click events by `code`.
- Each **consumer group** gets every message once; within a group, each partition is read by one consumer. More partitions = more parallelism.
- Messages are kept for days, so a new consumer (or a fixed buggy one) can **replay** history.

> [!plain] In plain English
> A queue is a to-do list where each task is done once. Pub/sub is a broadcast. A log is a recorded broadcast you can rewind.

## Delivery guarantees

| Guarantee | Means | Cost |
|---|---|---|
| at most once | may be lost, never duplicated | cheapest; fine for metrics you can afford to lose |
| **at least once** | never lost, may be **duplicated** | the common default |
| exactly once | neither | only within specific systems (Kafka transactions); end to end, you build it with idempotency |

So in practice: **assume duplicates, make consumers idempotent**.

## Idempotent consumers

Processing the same message twice must have the same effect as once. Techniques:

- **Natural idempotency**: "set status = shipped" is safe to repeat; "add 1 to counter" isn't.
- **Dedup by message id**: record processed `event_id`s (with a TTL) and skip repeats.
- **Upserts with versions**: `INSERT … ON CONFLICT (event_id) DO NOTHING`.

## The transactional outbox

A classic bug: save to the database, then publish an event, and crash in between. Now the database says "link created" but no event was ever sent (or the reverse).

The **outbox pattern**: in the **same database transaction**, write the business change **and** an `outbox` row describing the event. A separate relay reads new outbox rows and publishes them (retrying until it succeeds), then marks them sent. The event is published **at least once** if and only if the change committed.

## Backpressure

When producers outrun consumers, the queue grows. Monitor **queue depth** and **age of the oldest message**; scale consumers on them; and decide what happens at the limit: buffer longer, shed load (drop low-value events), or slow producers down.

## Batch vs stream analytics

| | Batch | Stream |
|---|---|---|
| when | periodically (hourly, nightly) over stored data | continuously, as events arrive |
| tools | Spark, SQL warehouses (BigQuery, Snowflake, Athena) | Flink, Kafka Streams, Kinesis Analytics |
| latency | minutes to hours | seconds |
| simpler? | yes | no |

Snip's design: click events go to a log; a stream job keeps **per-link, per-minute counters** for the live dashboard; raw events also land in object storage (S3) partitioned by date, and nightly batch queries produce detailed reports. Both read the same events.

:::quiz
q: Why publish click events instead of writing them to the database inside the redirect?
+ the redirect stays fast and keeps working even if analytics is slow or down
- databases can't store clicks
- events are more accurate
- it's required for 302 redirects
why: Async processing takes non-essential work off the critical path.
:::

:::quiz
q: Most message brokers guarantee at-least-once delivery. What must consumers therefore be?
- fast
+ idempotent
- stateless
- single-threaded
why: Duplicates happen with retries and redeliveries.
:::

:::quiz
q: In Kafka, how do you guarantee all clicks for one link are processed in order?
+ use the link code as the message key, so they all land in the same partition
- use one topic per link
- set exactly-once delivery
- use a single consumer for the whole topic
why: Ordering is per partition, and the key picks the partition.
:::

:::quiz
q: What problem does the transactional outbox solve?
+ keeping a database change and its published event consistent, even if the process crashes in between
- slow consumers
- duplicate messages
- large messages
why: The event is recorded in the same transaction as the change.
:::

:::exercise
id: da-idempotent
level: 3
title: An idempotent consumer
mode: code
lang: python
file: consumer.py
---
Write `handle(event: dict)` that skips the event if `seen.add_if_absent(event["event_id"], ttl=86400)` returns `False` (already processed), and otherwise calls `counters.increment(event["code"], event["minute"])`.
---starter
from infra import counters, seen
---rule
def\s+handle\(\s*event\s*:\s*dict\s*\)
The signature
---rule
seen\.add_if_absent\(\s*event\[\s*["']event_id["']\s*\]\s*,\s*ttl\s*=\s*86400\s*\)
Dedup by event id
---rule
if\s+not\s+seen\.add_if_absent\([^\n]*\)\s*:\s*\n\s+return
Skip duplicates
---rule
counters\.increment\(\s*event\[\s*["']code["']\s*\]\s*,\s*event\[\s*["']minute["']\s*\]\s*\)
Count the click
---solution
from infra import counters, seen


def handle(event: dict):
    if not seen.add_if_absent(event["event_id"], ttl=86400):
        return
    counters.increment(event["code"], event["minute"])
:::

:::exercise
id: da-outbox
level: 4
title: Write to the outbox
mode: code
lang: python
file: links.py
---
Write `create_link(conn, code: str, url: str)` that, **in one transaction** (`with conn.transaction():`), inserts the link with `conn.execute("INSERT INTO links (code, long_url) VALUES (%s, %s)", (code, url))` and inserts an outbox row with `conn.execute("INSERT INTO outbox (topic, payload) VALUES (%s, %s)", ("links.created", json.dumps({"code": code, "url": url})))`.
---starter
import json
---rule
def\s+create_link\(\s*conn\s*,\s*code\s*:\s*str\s*,\s*url\s*:\s*str\s*\)
The signature
---rule
with\s+conn\.transaction\(\s*\)\s*:
One transaction
---rule
INSERT INTO links \(code, long_url\) VALUES \(%s, %s\)["']\s*,\s*\(\s*code\s*,\s*url\s*\)
Insert the link
---rule
INSERT INTO outbox \(topic, payload\) VALUES \(%s, %s\)["']\s*,\s*\(\s*["']links\.created["']\s*,\s*json\.dumps\(\s*\{\s*["']code["']\s*:\s*code\s*,\s*["']url["']\s*:\s*url\s*\}\s*\)\s*\)
Insert the outbox event
---rule
with\s+conn\.transaction\(\s*\)\s*:\s*\n\s+conn\.execute\([\s\S]*?\n\s+conn\.execute\(
Both inside the transaction
---solution
import json


def create_link(conn, code: str, url: str):
    with conn.transaction():
        conn.execute("INSERT INTO links (code, long_url) VALUES (%s, %s)", (code, url))
        conn.execute("INSERT INTO outbox (topic, payload) VALUES (%s, %s)", ("links.created", json.dumps({"code": code, "url": url})))
:::

:::exercise
id: proj-design-07-partitions
level: 3
title: "Project 7: how many partitions?"
mode: answer
---
Snip's click topic receives 10,000 events/s at peak. One analytics consumer processes 800 events/s. Each partition is read by at most one consumer in a group. What's the **minimum** number of partitions so the group can keep up? (Round up.)
---answer
13
---solution
13
---explain
10,000 / 800 = 12.5 → 13 consumers, so at least 13 partitions. In practice you'd choose more (e.g. 24) for headroom.
:::

:::exercise
id: proj-design-07-model
level: 2
title: "Project 7b: queue or log?"
mode: answer
---
Snip's click events must feed a live dashboard, a fraud detector and the nightly reports, and a new consumer added next month should be able to process last week's events. Which model fits: `queue`, `pub/sub` or `log`?
---answer
log
---solution
log
:::
