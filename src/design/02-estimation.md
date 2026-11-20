---
id: design-estimation
title: Back-of-the-envelope estimation
summary: Powers of ten and handy constants, turning monthly volumes into requests per second, peak factors, storage growth over years, bandwidth, memory for caching, the latency numbers every engineer should know, and sanity-checking a design with arithmetic.
minutes: 35
---
> [!project] Taskboard, step 2: how big is it?
> Before choosing a database or counting servers, you need numbers: how many requests per second, how much storage over five years, how much memory a cache needs. This lesson turns "10 million people use Taskboard every day" into the figures every later decision depends on.

## Why estimate?

Estimation tells you **which problems you actually have**. 10 writes per second fits in any database on a laptop. 100,000 writes per second needs partitioning. You don't need precise numbers, just the right **order of magnitude**, fast. Round aggressively.

## Constants worth memorizing

| Quantity | Value |
|---|---|
| seconds in a day | 86,400 ≈ **10⁵** (100k) |
| seconds in a month | ≈ 2.6 M ≈ **2.5 × 10⁶** |
| seconds in a year | ≈ 31.5 M ≈ **3 × 10⁷** |
| 1 KB / MB / GB / TB / PB | 10³ / 10⁶ / 10⁹ / 10¹² / 10¹⁵ bytes |
| 1 million requests per day | ≈ **12 per second** |
| 1 billion requests per day | ≈ **12,000 per second** |

The notation 10⁵ means 1 followed by 5 zeros (100,000). Multiplying powers of ten adds the exponents (10³ × 10⁶ = 10⁹); dividing subtracts them (10⁹ ÷ 10⁵ = 10⁴).

## Worked example: Taskboard's traffic

Start from people, then multiply by what each person does. Taskboard has **10 million daily active users** (DAU). A typical user makes about **10 changes** a day (create, move, assign, comment) and **100 reads** (opening boards and tasks).

**Writes**: 10⁷ users × 10 = 10⁸ per day ÷ 10⁵ s ≈ **1,000 writes/second** on average.

**Reads**: 10⁷ × 100 = 10⁹ per day ÷ 10⁵ s ≈ **10,000 reads/second** on average. That's the 10:1 read:write ratio from lesson 1.

**Peak**: traffic isn't flat. Work happens on weekday mornings, so a typical rule of thumb is **2–3× the average** at peak. Plan for ~**30,000 reads/s** and **3,000 writes/s**.

For a figure given **per month**, divide by about 2.5 million seconds instead: 250 million requests a month is 2.5 × 10⁸ ÷ 2.5 × 10⁶ = 100 per second.

> [!plain] In plain English
> Divide "per day" by 100,000 (or "per month" by 2.5 million) to get "per second". Multiply by 2–3 for the busiest hour.

## Worked example: Taskboard's storage

What does one task cost?

| Field | Bytes |
|---|---|
| ids (task, board, workspace, assignee) | ~32 |
| title (average) | ~60 |
| description (average) | ~600 |
| status, dates, version | ~30 |
| index and row overhead | ~280 |
| **total** | **~1 KB** |

If each active user creates about **1 task a day**, that's 10⁷ tasks × 1 KB = 10¹⁰ B = **10 GB per day**, about **3.65 TB a year**, and ≈ **18 TB over 5 years**. With 3 copies for safety (replication, lesson 5): ~**55 TB**.

That's more than one database server comfortably holds and backs up, which is useful to know early: Taskboard **will** need to split its data across machines (sharding, lesson 5). Compare a URL shortener storing 200-byte links, which fits easily on one server: the per-record size and count decide this, not the product's popularity.

## Bandwidth

Multiply requests per second by bytes per response. A board load returns ~**20 KB** of JSON (the visible tasks). At 30,000 reads/s peak that's 30,000 × 20 KB = 600 MB/s, roughly **5 Gbit/s** leaving the servers. That's real money and real network capacity, so it's worth compressing responses, paginating long boards, and sending live updates as small changes ("task 42 moved to done") instead of the whole board again.

## Cache memory: the 80/20 rule

Usage is skewed: on any day, a minority of boards gets most of the views. A common rule of thumb is that **20% of the items get 80% of the reads**, so caching that 20% absorbs most traffic.

- about **5 million** distinct boards are opened on a typical day
- 20% of them = 10⁶ boards
- × ~20 KB per cached board = 2 × 10¹⁰ B = **20 GB** of cache

20 GB fits in the memory of one large cache node, or a small cluster of three. So a modest Redis cluster can serve most board loads (lesson 6).

## Latency numbers every engineer should know

Approximate, but the **ratios** are what matter:

| Operation | Time |
|---|---|
| L1 cache reference | 1 ns |
| main memory reference | 100 ns |
| read 1 MB sequentially from memory | ~10 µs |
| SSD random read | ~100 µs |
| round trip within a data center | ~0.5 ms |
| read 1 MB sequentially from SSD | ~1 ms |
| disk seek (spinning HDD) | ~10 ms |
| round trip US East ↔ Europe | ~80 ms |
| round trip US ↔ Australia | ~150–200 ms |

Takeaways: memory is ~1,000× faster than SSD, and network round trips dominate everything. Taskboard's 200 ms board-load target leaves room for a few round trips inside a data center, but not many cross-ocean ones: a user in Sydney talking to servers in Virginia spends most of that budget on the trip itself.

## Counting servers

Divide the peak load by what one server handles **safely** (well below its maximum, as lesson 1 explained), and **round up**: you can't run half a server. Then add spares so a failure doesn't drop you below peak capacity. Keeping one extra is called **N+1**: if 15 servers carry the peak, run 16, and losing any one still leaves 15.

## Sanity checks

Estimates catch impossible designs early: "each board load does 5 database queries" × 30,000/s = 150,000 queries/s on one database: far too many → you need a cache or replicas. "Write an activity row for every board view": 10⁹ rows a day is about 365 billion rows a year → you need a different storage approach for analytics (lesson 7).

:::quiz
q: About how many requests per second is 1 billion requests per day?
- 1,200
+ 12,000
- 120,000
- 1.2 million
why: 10⁹ / ~10⁵ seconds ≈ 10⁴.
:::

:::quiz
q: Which is fastest?
+ reading from main memory
- an SSD random read
- a round trip within a data center
- a round trip across the Atlantic
why: ~100 ns vs ~100 µs vs ~0.5 ms vs ~80 ms.
:::

:::quiz
q: Taskboard needs ~18 TB of task storage over 5 years (~55 TB with 3 copies). What does that tell you?
+ the data will outgrow one database server, so plan how to split it across machines
- storage is irrelevant at this size
- tasks must be deleted after a year
- one bigger disk solves it permanently
why: Tens of terabytes, growing every year, push the design toward sharding.
:::

:::quiz
q: Why use a peak factor in estimates?
+ traffic varies over the day; capacity must handle the busiest periods, not the average
- averages are always wrong
- to make numbers round
- because writes are bursty only
why: Systems fail at peak, not at average.
:::

:::exercise
id: de-rps
level: 1
title: Per month to per second
mode: answer
---
A service receives 250 million requests per month. Using ~2.5 million seconds per month, roughly how many requests per second is that on average?
---answer
100
---solution
100
:::

:::exercise
id: de-storage
level: 2
title: Storage for a year
mode: answer
---
A photo service stores 2 million photos per day at 500 KB each (no replication). Roughly how many **terabytes** per year? (Use 365 days; round to the nearest whole number.)
---answer
365
---solution
365
---explain
2 × 10⁶ × 5 × 10⁵ B = 10¹² B = 1 TB per day; × 365.
:::

:::exercise
id: de-servers
level: 3
title: How many servers?
mode: answer
---
Peak traffic is 30,000 requests per second. One app server handles 2,000 requests per second at a safe utilization. You want to survive losing one server at peak. How many servers do you need?
---answer
16
---solution
16
---explain
30,000 / 2,000 = 15 needed, plus one spare (N+1) = 16.
:::

:::exercise
id: proj-design-02-reads
level: 2
title: "Project 2: Taskboard's write traffic"
mode: answer
---
Taskboard has 10 million daily active users who each make about 10 changes a day. Roughly how many writes per second on **average**? (Use 10⁵ seconds per day.)
---answer
1000
---answer
1,000
---solution
1000
---explain
10⁷ × 10 = 10⁸ writes per day ÷ 10⁵ s = 10³ per second.
:::

:::exercise
id: proj-design-02-storage
level: 3
title: "Project 2b: Taskboard's storage"
mode: answer
---
Taskboard stores about 18 billion tasks after 5 years, at ~1 KB each, kept in **3** copies. Roughly how many **terabytes** is that?
---answer
54
---answer
54 TB
---solution
54
---explain
1.8 × 10¹⁰ × 10³ B = 1.8 × 10¹³ B = 18 TB; × 3 copies = 54 TB.
:::

:::exercise
id: proj-design-02-cache
level: 3
title: "Project 2c: cache sizing"
mode: answer
---
Taskboard wants to cache the hottest 20% of the **5 million** boards opened per day, at 20 KB each. How many **gigabytes** of cache is that?
---answer
20
---answer
20 GB
---solution
20
---explain
0.2 × 5 × 10⁶ = 10⁶ boards × 2 × 10⁴ B = 2 × 10¹⁰ B = 20 GB.
:::
