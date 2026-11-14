---
id: design-estimation
title: Back-of-the-envelope estimation
summary: Powers of ten and handy constants, turning monthly volumes into requests per second, peak factors, storage growth over years, bandwidth, memory for caching, the latency numbers every engineer should know, and sanity-checking a design with arithmetic.
minutes: 35
---
> [!project] Snip, step 2: how big is it?
> Before choosing a database or counting servers, you need numbers: how many requests per second, how much storage over five years, how much memory a cache needs. This lesson turns Snip's "100 million new links a month" into the figures every later decision depends on.

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

## Worked example: Snip's traffic

**Writes** (new links): 100 M per month.

100 × 10⁶ ÷ (2.5 × 10⁶ s) ≈ **40 writes/second** on average.

**Reads** (redirects): 100× writes ≈ **4,000 reads/second** on average.

**Peak**: traffic isn't flat. A typical rule of thumb is **2–3× the average** at peak (viral links can spike far higher locally). Plan for ~**10,000 redirects/s** peak.

> [!plain] In plain English
> Divide "per month" by about 2.5 million to get "per second". Multiply by 2–3 for the busiest hour.

## Worked example: Snip's storage

What does one link record cost?

| Field | Bytes |
|---|---|
| short code (7 chars) | 7 |
| long URL (average) | ~100 |
| owner id, created_at, expires_at | ~30 |
| index and row overhead | ~60 |
| **total** | **~200 bytes** |

Links are kept for **5 years**: 100 M/month × 12 × 5 = **6 billion links**.

6 × 10⁹ × 200 B = 1.2 × 10¹² B ≈ **1.2 TB**. With replication (×3): ~**3.6 TB**. That's comfortably within one modern database server's disk, which is useful to know: Snip's storage **isn't** the hard part; its read traffic and availability are.

## Bandwidth

Redirect responses are tiny (~500 bytes with headers): 10,000/s × 500 B = **5 MB/s** at peak. Bandwidth isn't a concern either. (For a video service, this line of the estimate is where everything gets hard.)

## Cache memory: the 80/20 rule

Link popularity is very skewed: a small fraction of links gets most clicks. If we cache the hottest 20% of **one day's** distinct links:

- daily redirects ≈ 4,000/s × 10⁵ s ≈ 4 × 10⁸ requests
- assume ~10⁸ distinct links accessed per day; 20% = 2 × 10⁷ links
- × ~200 B = **4 GB** of cache

4 GB fits in the memory of a single cache node. So a small Redis cluster can absorb most of Snip's read traffic.

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

Takeaways: memory is ~1,000× faster than SSD, and network round trips dominate everything. A redirect target of 50 ms p99 means **no cross-ocean round trips** on the hot path: users must be served from a nearby region.

## Sanity checks

Estimates catch impossible designs early: "each redirect does 3 database queries" × 10,000/s = 30,000 queries/s on one database: too many → you need a cache or replicas. "Store every click as a row": 4 × 10⁸ rows a day is about 146 billion rows a year → you need a different storage approach for analytics (lesson 7).

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
q: Snip needs ~1.2 TB of link storage over 5 years. What does that tell you?
+ storage volume alone doesn't force a distributed database; reads and availability are the harder problems
- Snip must shard immediately
- links must be compressed
- storage is the main bottleneck
why: A single server can hold a few TB; the design pressure comes elsewhere.
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
title: "Project 2: Snip's read traffic"
mode: answer
---
Snip creates 100 million links per month with a 100:1 read:write ratio. Roughly how many redirects per second on average? (Use 2.5 million seconds per month.)
---answer
4000
---answer
4,000
---solution
4000
:::

:::exercise
id: proj-design-02-storage
level: 3
title: "Project 2b: Snip's storage"
mode: answer
---
Snip keeps 6 billion links of ~200 bytes each, replicated **3** times. Roughly how many **terabytes** is that?
---answer
3.6
---solution
3.6
:::

:::exercise
id: proj-design-02-cache
level: 3
title: "Project 2c: cache sizing"
mode: answer
---
Snip wants to cache 20% of the **50 million** distinct links clicked per day, at 200 bytes each. How many **gigabytes** of cache is that?
---answer
2
---solution
2
---explain
0.2 × 5 × 10⁷ = 10⁷ links × 200 B = 2 × 10⁹ B = 2 GB.
:::
