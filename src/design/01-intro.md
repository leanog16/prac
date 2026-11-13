---
id: design-intro
title: Thinking in systems
summary: What system design is, functional vs non-functional requirements, availability nines, latency and throughput, SLIs, SLOs and SLAs, trade-offs as the core skill, and a repeatable process for any design question.
minutes: 30
---
> [!project] Track project: Snip, a URL shortener
> Through this track you'll design **Snip**: paste a long URL, get `snip.ly/aZ3kQ9`, and anyone who opens the short link is redirected. It sounds trivial, which is exactly why it's the classic teaching problem: every scaling idea in this track (estimation, APIs, databases, sharding, caching, queues, rate limiting, reliability) shows up in it naturally. Each lesson's **Project** exercises make the next design decision.

## What system design is

Writing a function is about **correctness**. Designing a system is about correctness **plus** everything that happens when real users, real failures and real growth arrive:

- What happens with 100× the traffic?
- What happens when a server, a database or a whole data center fails?
- How fast is it, for whom, and how do we know?
- What does it cost, and who can operate it at 3 a.m.?

There's rarely one right answer. There are **trade-offs**: every choice makes something better and something else worse. The skill is choosing deliberately and explaining why.

## Requirements first

**Functional requirements**: what the system does.

| Snip must… |
|---|
| create a short link for a long URL (optionally with a custom alias) |
| redirect a short link to its long URL |
| let a link expire after a chosen time |
| show basic click statistics to the link's owner |

**Non-functional requirements**: how well it does it.

| Quality | Snip target | Why it matters |
|---|---|---|
| availability | 99.99% for redirects | a broken redirect is a broken link in someone's email or printed poster |
| latency | redirect p99 < 50 ms | users wait for redirects before seeing the real page |
| scale | 100 M new links/month, 100:1 read:write | sizing everything else |
| durability | a created link must never be lost | links are printed and shared permanently |
| consistency | a new link should work within a second or so | creation is followed by sharing |

Non-functional requirements drive architecture far more than functional ones. "Store a URL and look it up" fits in 20 lines of code; "do it 40,000 times a second with 99.99% availability" is the actual design problem.

> [!plain] In plain English
> Functional requirements say **what** the system does. Non-functional requirements say **how fast, how big, how reliable and how cheap** it must be, and they decide most of the design.

## Availability in nines

| Availability | Downtime per year | Per month |
|---|---|---|
| 99% ("two nines") | 3.65 days | 7.3 hours |
| 99.9% | 8.8 hours | 43.8 minutes |
| 99.95% | 4.4 hours | 21.9 minutes |
| 99.99% | 52.6 minutes | 4.4 minutes |
| 99.999% | 5.3 minutes | 26 seconds |

Each extra nine costs roughly an order of magnitude more effort: redundancy everywhere, automated failover, careful deployments. Pick the nines the business actually needs.

Components in **series** multiply: an app at 99.9% that depends on a database at 99.9% is at most 99.9% × 99.9% ≈ **99.8%**. Redundant components in **parallel** add availability: two independent 99% replicas give 1 − 0.01² = **99.99%**.

## Latency and throughput

- **Latency**: how long one request takes. Report **percentiles**, not averages: p50 (typical), p99 (the slowest 1%), p99.9. An average of 40 ms can hide 1% of users waiting 3 seconds, and at scale, 1% is a lot of people.
- **Throughput**: how many requests per second (RPS/QPS) the system handles.

They interact: as a system approaches its maximum throughput, queues form and latency climbs sharply. Plan to run at well under capacity.

## SLIs, SLOs and SLAs

| Term | Is | Snip example |
|---|---|---|
| **SLI** (indicator) | a measurement | % of redirects answered with a 3xx in < 100 ms |
| **SLO** (objective) | an internal target for an SLI | 99.95% over 28 days |
| **SLA** (agreement) | a contractual promise, with penalties | 99.9%, or customers get credits |

The gap between SLO and SLA is your safety margin. The **error budget** is the allowed unreliability (0.05% of requests here): while you have budget left, ship features; when it's spent, focus on reliability.

## A process for any design question

1. **Clarify requirements**: functional, non-functional, what's out of scope.
2. **Estimate**: traffic, storage, bandwidth (next lesson).
3. **Define the API** and the **data model**.
4. **Sketch a simple design** that works end to end.
5. **Scale it**: find the bottlenecks and address them one at a time.
6. **Discuss trade-offs, failures and operations**: what breaks, how you'd know, what you'd do.

:::quiz
q: Which of these is a non-functional requirement?
- users can set a custom alias
+ redirects complete in under 50 ms at the 99th percentile
- links can expire
- owners can see click counts
why: It describes how well the system performs, not what it does.
:::

:::quiz
q: Roughly how much downtime per month does 99.9% availability allow?
- 26 seconds
- 4.4 minutes
+ about 43 minutes
- 7 hours
why: 0.1% of ~43,800 minutes.
:::

:::quiz
q: A service at 99.9% depends on another service at 99.9%. What's the best the combined system can achieve?
- 99.9%
+ about 99.8%
- 99.99%
- 100%
why: Serial dependencies multiply availabilities.
:::

:::quiz
q: Why report p99 latency instead of the average?
+ the average hides the slow tail that a meaningful share of users experience
- p99 is always lower
- averages can't be computed for latency
- p99 is cheaper to measure
why: Tail latency is what unhappy users feel.
:::

:::exercise
id: di-nines
level: 2
title: Two replicas
mode: answer
---
Two independent replicas each have 99% availability, and the system works if **either** is up. What's the combined availability, as a percentage?
---answer
99.99
---answer
99.99%
---solution
99.99
---explain
The system is down only when both are down: 0.01 × 0.01 = 0.0001, so availability is 1 − 0.0001 = 99.99%.
:::

:::exercise
id: di-series
level: 2
title: Three in a row
mode: answer
---
A request passes through a load balancer (99.99%), an app server (99.9%) and a database (99.95%), all required. What's the approximate combined availability? Answer as a percentage with two decimals.
---answer
99.84
---answer
99.84%
---solution
99.84
---explain
0.9999 × 0.999 × 0.9995 ≈ 0.9984.
:::

:::exercise
id: di-budget
level: 3
title: Error budget
mode: answer
---
Snip's redirect SLO is 99.95% over 30 days, and it serves 1 billion redirects in that period. How many failed redirects does the error budget allow?
---answer
500000
---answer
500,000
---solution
500000
:::

:::exercise
id: proj-design-01-fr
level: 2
title: "Project 1: functional or not?"
mode: answer
---
Classify this Snip requirement as `functional` or `non-functional`: "Short links must keep working even if one data center goes offline."
---answer
non-functional
---answer
nonfunctional
---solution
non-functional
:::

:::exercise
id: proj-design-01-slo
level: 2
title: "Project 1b: SLI, SLO or SLA?"
mode: answer
---
Snip's contract with enterprise customers says: "If monthly redirect availability falls below 99.9%, you receive a 10% credit." Is that an SLI, an SLO or an SLA?
---answer
SLA
---solution
SLA
:::

:::exercise
id: proj-design-01-reqs
level: 3
title: "Project 1c: write the requirements"
mode: code
lang: yaml
file: snip-requirements.yaml
---
Write Snip's requirements as YAML: a `functional` list containing (at least) `create short link`, `redirect`, `expiry` and `click stats`; and a `non_functional` map with `availability: "99.99%"`, `redirect_p99_ms: 50`, `new_links_per_month: 100000000` and `read_write_ratio: "100:1"`.
---starter
# Snip requirements
---rule
^functional:\s*\n(\s+-\s+.+\n?)+
A `functional` list
---rule
-\s+create short link
`create short link`
---rule
-\s+redirect\s*$
`redirect`
---rule
-\s+expiry
`expiry`
---rule
-\s+click stats
`click stats`
---rule
^non_functional:
A `non_functional` map
---rule
availability:\s*["']99\.99%["']
Availability
---rule
redirect_p99_ms:\s*50\b
Latency
---rule
new_links_per_month:\s*100000000\b
Write volume
---rule
read_write_ratio:\s*["']100:1["']
Read:write ratio
---solution
functional:
  - create short link
  - redirect
  - expiry
  - click stats
non_functional:
  availability: "99.99%"
  redirect_p99_ms: 50
  new_links_per_month: 100000000
  read_write_ratio: "100:1"
:::
