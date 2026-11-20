---
id: design-async
title: Queues, events & stream processing
summary: Synchronous vs asynchronous work, message queues and their delivery guarantees, pub/sub and event-driven architecture, Kafka-style logs with partitions and consumer groups, idempotent consumers, the transactional outbox, backpressure, and batch vs stream analytics.
minutes: 40
---
> [!project] Taskboard, step 7: events
> When a task is assigned, several things should follow: the assignee gets an email or push notification, the search index learns the new state, the activity feed shows "Ana assigned TB-1042 to Ben", and teammates looking at the board see it move. Doing all of that inside the request would make every change slow and fragile. This step publishes **events** and lets each of those jobs happen asynchronously, at up to 3,000 changes a second.

## Do it later

A request should only do the work the user **waits for**. Everything else (sending emails, updating search indexes, writing activity feeds, resizing avatars) can happen **asynchronously**, later and elsewhere:

```
PATCH /tasks/42 ─► update the task ─► publish {"type": "task.assigned", "task_id": 42, …} ─► 200   (fast)
                                              │
                                       message broker
                                ┌─────────────┼──────────────┐
                        notifications     search index    activity feed   (each at its own pace)
```

A **message broker** is a server that accepts messages from **producers** and hands them to **consumers**, storing them in between. Benefits: lower latency for users, the board keeps working when email is down, and consumers can be scaled, paused or replayed independently.

## Queues vs pub/sub vs logs

| Model | Each message goes to | Examples | Use |
|---|---|---|---|
| **queue** | **one** consumer of a pool (competing consumers) | SQS, RabbitMQ queues | jobs: "send this email" |
| **pub/sub** | **every** subscriber | SNS, Google Pub/Sub, RabbitMQ fanout | events many services care about |
| **log** (stream) | consumers read at their own offset; messages are **retained** and replayable | Kafka, Kinesis, Redpanda | high-volume event streams, analytics, event sourcing |

### Kafka-style logs in one picture

```
topic "task-events", 3 partitions (ordered within a partition)
p0: e1 e4 e7 e10 …     ◄── consumer A (group "notifications")
p1: e2 e5 e8 …         ◄── consumer B (group "notifications")
p2: e3 e6 e9 …         ◄── consumer C (group "notifications")
                          and independently, group "search" reads all partitions at its own offsets
```

- A **topic** is a named stream of messages; it's split into **partitions** so several machines can share the work.
- A message's **key** chooses its partition (`hash(key) % partitions`). Same key → same partition → **ordered** for that key. Taskboard keys task events by `board_id`, so "moved to doing" and "moved to done" for a board are always processed in that order.
- Each **consumer group** (one per job: notifications, search…) receives every message; within a group, each partition is read by **at most one** consumer, so the partition count caps how many consumers can share the work. To keep up with a topic, a group needs at least *events per second ÷ events one consumer handles per second* consumers (rounded up), and therefore at least that many partitions.
- An **offset** is a consumer's position in a partition, like a bookmark. Processing can repeat after failures (a consumer crashes before saving its offset), so consumers need idempotency.
- Messages are kept for days, so a new consumer (or a fixed buggy one) can **replay** history.

> [!plain] In plain English
> A queue is a to-do list where workers share tasks, possibly receiving a task more than once. Pub/sub is a broadcast. A log is a recorded broadcast you can rewind.

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
- **Dedup by message id**: every event carries a unique `event_id`; record the ids you've processed (with a TTL) and skip repeats. With Redis this is one atomic "add if absent" operation that returns `True` when the id is new and `False` when it was already there:

```python
def handle(event: dict):
    if not seen.add_if_absent(event["event_id"], ttl=86400):   # seen in the last day?
        return                                                  # duplicate: do nothing
    send_notification(event["assignee_id"], event["task_id"])
```
- **Upserts with versions**: `INSERT … ON CONFLICT (event_id) DO NOTHING`.

## The transactional outbox

A classic bug: save to the database, then publish an event, and crash in between. Now the database says "assigned to Ben" but Ben is never notified (or the reverse: the event goes out, the save fails).

The **outbox pattern**: in the **same database transaction**, write the business change **and** an `outbox` row describing the event. A **transaction** is a group of statements the database applies all together or not at all. A separate relay process reads new outbox rows and publishes them (retrying until it succeeds), then marks them sent. The event is published **at least once** if and only if the change committed.

```python
import json

def assign_task(conn, task_id: int, user_id: int):
    with conn.transaction():          # both statements commit together, or neither does
        conn.execute("UPDATE tasks SET assignee_id = %s WHERE id = %s", (user_id, task_id))
        conn.execute("INSERT INTO outbox (topic, payload) VALUES (%s, %s)",
                     ("task.assigned", json.dumps({"task_id": task_id, "user_id": user_id})))
```

`conn.execute(sql, params)` runs one statement; each `%s` is filled from the tuple of parameters, safely escaped. `json.dumps` turns a dictionary into a JSON string for the payload column.

## Backpressure

When producers outrun consumers, the queue grows. Monitor **queue depth** and **age of the oldest message**; scale consumers on them; and decide what happens at the limit: buffer longer, shed load (drop low-value events), or slow producers down.

## Batch vs stream analytics

| | Batch | Stream |
|---|---|---|
| when | periodically (hourly, nightly) over stored data | continuously, as events arrive |
| tools | Spark, SQL warehouses (BigQuery, Snowflake, Athena) | Flink, Kafka Streams, Kinesis Analytics |
| latency | minutes to hours | seconds |
| simpler? | yes | no |

Taskboard's design: task events go to a log; a stream job keeps **per-workspace, per-day counters** ("tasks completed today") for the dashboard; raw events also land in object storage (S3) partitioned by date, and nightly batch queries produce detailed reports for team leads. Both read the same events.

:::quiz
q: Why publish a `task.assigned` event instead of sending the email inside the request?
+ the request stays fast and keeps working even if the email provider is slow or down
- databases can't store assignments
- events are more accurate
- emails can't be sent from web servers
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
q: In Kafka, how do you guarantee all events for one board are processed in order?
+ use the board id as the message key, so they all land in the same partition
- use one topic per board
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
Write `handle(event: dict)` for the activity counter: skip the event if `seen.add_if_absent(event["event_id"], ttl=86400)` returns `False` (already processed), and otherwise call `counters.increment(event["workspace_id"], event["day"])`.
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
counters\.increment\(\s*event\[\s*["']workspace_id["']\s*\]\s*,\s*event\[\s*["']day["']\s*\]\s*\)
Count the event
---solution
from infra import counters, seen


def handle(event: dict):
    if not seen.add_if_absent(event["event_id"], ttl=86400):
        return
    counters.increment(event["workspace_id"], event["day"])
:::

:::exercise
id: da-outbox
level: 4
title: Write to the outbox
mode: code
lang: python
file: tasks.py
---
Write the lesson's `assign_task(conn, task_id: int, user_id: int)`: **in one transaction** (`with conn.transaction():`), run `conn.execute("UPDATE tasks SET assignee_id = %s WHERE id = %s", (user_id, task_id))` and then insert the outbox row with `conn.execute("INSERT INTO outbox (topic, payload) VALUES (%s, %s)", ("task.assigned", json.dumps({"task_id": task_id, "user_id": user_id})))`.
---starter
import json
---rule
def\s+assign_task\(\s*conn\s*,\s*task_id\s*:\s*int\s*,\s*user_id\s*:\s*int\s*\)
The signature
---rule
with\s+conn\.transaction\(\s*\)\s*:
One transaction
---rule
UPDATE tasks SET assignee_id = %s WHERE id = %s["']\s*,\s*\(\s*user_id\s*,\s*task_id\s*\)
Update the task
---rule
INSERT INTO outbox \(topic, payload\) VALUES \(%s, %s\)["']\s*,\s*\(\s*["']task\.assigned["']\s*,\s*json\.dumps\(\s*\{\s*["']task_id["']\s*:\s*task_id\s*,\s*["']user_id["']\s*:\s*user_id\s*\}\s*\)\s*\)
Insert the outbox event
---rule
with\s+conn\.transaction\(\s*\)\s*:\s*\n\s+conn\.execute\([\s\S]*?\n\s+conn\.execute\(
Both inside the transaction
---solution
import json


def assign_task(conn, task_id: int, user_id: int):
    with conn.transaction():
        conn.execute("UPDATE tasks SET assignee_id = %s WHERE id = %s", (user_id, task_id))
        conn.execute("INSERT INTO outbox (topic, payload) VALUES (%s, %s)", ("task.assigned", json.dumps({"task_id": task_id, "user_id": user_id})))
:::

:::exercise
id: proj-design-07-partitions
level: 3
title: "Project 7: how many partitions?"
mode: answer
---
Taskboard's `task-events` topic receives 3,000 events/s at peak. One notification consumer processes 250 events/s. Each partition is read by at most one consumer in a group. What's the **minimum** number of partitions so the group can keep up? (Round up.)
---answer
12
---solution
12
---explain
3,000 / 250 = 12 consumers, so at least 12 partitions. In practice you'd choose more (e.g. 24) for headroom.
:::

:::exercise
id: proj-design-07-model
level: 2
title: "Project 7b: queue or log?"
mode: answer
---
Taskboard's task events must feed notifications, the search index and the activity feed, and a new consumer added next month (say, a reporting job) should be able to process last week's events. Which model fits: `queue`, `pub/sub` or `log`?
---answer
log
---solution
log
---explain
Several independent consumers plus replay of past events is exactly what a retained log gives you.
:::

:::exercise
id: proj-design-07-notify
level: 3
title: "Project 7c: notify exactly once (in effect)"
mode: code
lang: python
file: notify.py
path: docs/design/notify.py
---
Write the notification consumer `handle(event: dict)`: return early if `seen.add_if_absent(event["event_id"], ttl=86400)` is `False`; otherwise call `send_notification(event["assignee_id"], event["task_id"])`.
---starter
from infra import seen, send_notification
---rule
def\s+handle\(\s*event\s*:\s*dict\s*\)
The signature
---rule
if\s+not\s+seen\.add_if_absent\(\s*event\[\s*["']event_id["']\s*\]\s*,\s*ttl\s*=\s*86400\s*\)\s*:\s*\n\s+return
Skip duplicates
---rule
send_notification\(\s*event\[\s*["']assignee_id["']\s*\]\s*,\s*event\[\s*["']task_id["']\s*\]\s*\)
Send the notification
---solution
from infra import seen, send_notification


def handle(event: dict):
    if not seen.add_if_absent(event["event_id"], ttl=86400):
        return
    send_notification(event["assignee_id"], event["task_id"])
---explain
The broker delivers at least once; recording the event id makes a redelivery harmless, so Ben gets one email, not two.
:::
