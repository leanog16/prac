---
id: design-intro
title: Thinking in systems
summary: What system design is, functional vs non-functional requirements, availability nines, latency and throughput, SLIs, SLOs and SLAs, trade-offs as the core skill, a repeatable process for any design question, and the YAML format the track's design documents use.
minutes: 35
---
> [!project] Track project: Taskboard at scale
> In the other tracks you built **Taskboard**, the task tracker where a team creates tasks, moves them from `todo` to `doing` to `done`, assigns them and comments on them. Now imagine it succeeds: millions of people use it every day. In this track you design the system that keeps it fast and available at that size. Each lesson's **Project** exercises make the next design decision and save it to `docs/design/` in your Taskboard repo.

## What system design is

Writing a function is about **correctness**. Designing a system is about correctness **plus** everything that happens when real users, real failures and real growth arrive:

- What happens with 100× the traffic?
- What happens when a server, a database or a whole data center fails?
- How fast is it, for whom, and how do we know?
- What does it cost, and who can operate it at 3 a.m.?

There's rarely one right answer. There are **trade-offs**: every choice makes something better and something else worse. The skill is choosing deliberately and explaining why.

## How this track works

Most exercises ask for a number or a word: you estimate, classify or pick a design option, and type the answer. Some ask for short **Python** code that implements a design idea (a cache lookup, a rate limiter). Each of those lessons shows the pattern in a worked example first, and the exercise names every function you need. A few ask you to write a design document in **YAML**; the format is explained at the end of this lesson.

## Requirements first

**Functional requirements**: what the system does.

| Taskboard must… |
|---|
| create a task on a board |
| move a task between the `todo`, `doing` and `done` columns |
| assign tasks and comment on them |
| show changes to everyone looking at the same board, live |
| notify people when they're assigned or mentioned |

**Non-functional requirements**: how well it does it.

| Quality | Taskboard target | Why it matters |
|---|---|---|
| availability | 99.95% for reading and changing boards | teams plan their whole day on the board |
| latency | board load p99 < 200 ms | a slow board feels broken |
| scale | 10 M daily active users; 10:1 read:write | sizing everything else |
| durability | an acknowledged change is never lost | people trust the board as the record of work |
| freshness | teammates see a change within 2 seconds | the board is shared, live |

Non-functional requirements drive architecture far more than functional ones. "Store a task and list a board" fits in 50 lines of code (you wrote them in the FastAPI track); "serve 10 million people at 99.95% with live updates" is the actual design problem.

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

For independent failures, components in **series** (all required) multiply: an app at 99.9% that depends on a database at 99.9% has combined availability of about 99.9% × 99.9% ≈ **99.8%**. Redundant components in **parallel** (any one is enough) are down only when all are down: two independent 99% replicas are both down 0.01 × 0.01 = 0.0001 of the time, so together they're up 1 − 0.0001 = **99.99%**. (Correlated failures, like two replicas in the same burning data center, need a different analysis.)

## Latency and throughput

- **Latency**: how long one request takes. Report **percentiles**, not averages: p50 (half the requests are faster than this), p99 (the slowest 1% are slower than this), p99.9. An average of 40 ms can hide 1% of users waiting 3 seconds, and at scale, 1% is a lot of people.
- **Throughput**: how many requests per second (RPS, or QPS for queries) the system handles.

They interact: as a system approaches its maximum throughput, queues form and latency climbs sharply. Plan to run at well under capacity.

## SLIs, SLOs and SLAs

| Term | Is | Taskboard example |
|---|---|---|
| **SLI** (indicator) | a measurement | % of board loads answered successfully in < 200 ms |
| **SLO** (objective) | an internal target for an SLI | 99.95% over 30 days |
| **SLA** (agreement) | a contractual promise to customers, with penalties | 99.9%, or customers get credits |

The gap between SLO and SLA is your safety margin. The **error budget** is the unreliability the SLO allows: with a 99.95% SLO, 0.05% of requests may fail. Multiply that fraction by the request count to get the budget: 0.05% of 1,000,000 requests is 0.0005 × 1,000,000 = 500 failed requests. While budget is left, ship features; when it's spent, focus on reliability.

## A process for any design question

1. **Clarify requirements**: functional, non-functional, what's out of scope.
2. **Estimate**: traffic, storage, bandwidth (next lesson).
3. **Define the API** and the **data model**.
4. **Sketch a simple design** that works end to end.
5. **Scale it**: find the bottlenecks and address them one at a time.
6. **Discuss trade-offs, failures and operations**: what breaks, how you'd know, what you'd do.

## Writing design documents in YAML

Design decisions are only useful if they're written down where the team will find them: in the repository, next to the code. Taskboard keeps its design notes as small **YAML** files in `docs/design/`. YAML is a plain-text format for structured data: people can read and review it in a pull request, and tools can read it too. (You'll meet YAML again for Docker Compose files, CI/CD workflows and AWS templates; it's the same format everywhere.)

Three building blocks cover everything this track needs:

```yaml
# A comment starts with #. YAML ignores it.
service: taskboard            # a key, a colon, a space, then the value
availability: "99.95%"        # quote values that contain symbols such as % or :
board_p99_ms: 200             # numbers are written plainly, without quotes

non_functional:               # a key with nothing after the colon starts a nested map...
  availability: "99.95%"      # ...whose entries are indented by two spaces
  read_write_ratio: "10:1"

functional:                   # a list: each item is indented and starts with "- "
  - create task
  - move task
```

The rules that trip people up:

- **Indentation is the structure.** Entries of a nested map or list are indented by the same number of spaces (two, by convention). Tabs are not allowed.
- **A space after the colon** (`key: value`). `key:value` isn't a key-value pair.
- **Quote values with symbols.** `"99.95%"` and `"10:1"` must be quoted, because an unquoted `10:1` is read by some YAML tools as a number in base 60.
- A list item can be any text: `- move task` is the string `move task`.

> [!plain] In plain English
> YAML is a tidy way to write an outline: `name: value` lines, indentation for things that belong inside other things, and `- ` for each item in a list.

:::quiz
q: Which of these is a non-functional requirement?
- users can assign a task to a teammate
+ board loads complete in under 200 ms at the 99th percentile
- tasks can be moved to `done`
- people are notified when mentioned
why: It describes how well the system performs, not what it does.
:::

:::quiz
q: Roughly how much downtime per month does 99.9% availability allow?
- 26 seconds
- 4.4 minutes
+ about 43 minutes
- 7 hours
why: 0.1% of ~43,800 minutes in a month.
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

:::quiz
q: In a YAML file, how do you show that `availability` belongs inside `non_functional`?
- put it on the same line after a comma
+ write it on the next line, indented under `non_functional:`
- wrap both in curly braces
- prefix it with `- `
why: Indentation is YAML's structure; `- ` marks list items, not nested keys.
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
Taskboard's board-load SLO is 99.95% over 30 days, and it serves 1 billion board loads in that period. How many failed board loads does the error budget allow?
---answer
500000
---answer
500,000
---solution
500000
---explain
The budget is 100% − 99.95% = 0.05% = 0.0005 of requests: 0.0005 × 1,000,000,000 = 500,000.
:::

:::exercise
id: proj-design-01-fr
level: 2
title: "Project 1: functional or not?"
mode: answer
---
Classify this Taskboard requirement as `functional` or `non-functional`: "Boards must keep working even if one data center goes offline."
---answer
non-functional
---answer
nonfunctional
---solution
non-functional
---explain
It says how reliable the system must be, not what it does.
:::

:::exercise
id: proj-design-01-slo
level: 2
title: "Project 1b: SLI, SLO or SLA?"
mode: answer
---
Taskboard's contract with business customers says: "If monthly availability falls below 99.9%, you receive a 10% credit." Is that an SLI, an SLO or an SLA?
---answer
SLA
---solution
SLA
---explain
It's a promise to customers with a penalty attached: an agreement.
:::

:::exercise
id: proj-design-01-reqs
level: 3
title: "Project 1c: write the requirements"
mode: code
lang: yaml
file: requirements.yaml
path: docs/design/requirements.yaml
---
Write Taskboard's requirements as YAML (see "Writing design documents in YAML" in the lesson). Add a `functional` list containing (at least) `create task`, `move task`, `assign task` and `live updates`; and a `non_functional` map with `availability: "99.95%"`, `board_p99_ms: 200`, `daily_active_users: 10000000` and `read_write_ratio: "10:1"`.
---starter
# Taskboard requirements
---hint
Start with `functional:` on its own line, then one indented `- create task` line per item.
---hint
`non_functional:` also goes on its own line; its four entries are indented two spaces, each as `key: value`.
---rule
^functional:\s*\n(\s+-\s+.+\n?)+
A `functional` list
---rule
-\s+create task
`create task`
---rule
-\s+move task
`move task`
---rule
-\s+assign task
`assign task`
---rule
-\s+live updates
`live updates`
---rule
^non_functional:\s*\n\s+\w
A `non_functional` map with indented entries
---rule
^\s+availability:\s*["']99\.95%["']
Availability (quoted)
---rule
^\s+board_p99_ms:\s*200\b
Latency
---rule
^\s+daily_active_users:\s*10000000\b
Daily active users
---rule
^\s+read_write_ratio:\s*["']10:1["']
Read:write ratio (quoted)
---solution
functional:
  - create task
  - move task
  - assign task
  - live updates
non_functional:
  availability: "99.95%"
  board_p99_ms: 200
  daily_active_users: 10000000
  read_write_ratio: "10:1"
:::
