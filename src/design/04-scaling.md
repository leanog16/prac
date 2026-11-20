---
id: design-scaling
title: Scaling the stateless tier
summary: Vertical vs horizontal scaling, why stateless servers scale and stateful ones don't, where session state should live, load balancers (L4 vs L7, algorithms, health checks), autoscaling, CDNs and edge caching, and serving users in several regions.
minutes: 35
---
> [!project] Taskboard, step 4: from one box to many
> The Taskboard you deployed in the AWS track is one service with a database behind it, comfortable at a few hundred requests per second. This step takes the **app tier** (the servers running the API code) to 30,000+ per second: many identical servers behind a load balancer, with a CDN in front, and a plan for the one part that isn't stateless: live updates.

## Vertical vs horizontal

| | Vertical ("scale up") | Horizontal ("scale out") |
|---|---|---|
| how | a bigger machine: more CPU, RAM | more machines of the same size |
| limit | the biggest machine you can buy | practically none for stateless work |
| failure | one machine = one point of failure | one machine of N fails → capacity drops by 1/N |
| complexity | none: same code | needs load balancing, stateless design |
| good first step? | often yes: it's cheap engineering | when vertical runs out, or for availability |

Start vertical (it's boring and it works), but design so you **can** go horizontal.

## Stateless servers

A server is **stateless** when any request can go to any instance, because nothing about the user is kept in that server's memory or disk between requests. Most of Taskboard's API is naturally stateless: "move task 42 to done" carries everything needed (the token says who you are, the database holds the task).

What breaks statelessness:

- **in-memory sessions** ("user 42 is logged in" stored in one server's RAM): the next request lands elsewhere and the user is logged out;
- **local file uploads**: the file lives on one server only;
- **in-process caches** that must be consistent: each server has a different copy.

Move that state **out** of the app servers: sessions into a shared store such as **Redis** (an in-memory key-value database that every server can reach over the network) or into signed tokens (JWTs) carried by the client, files into object storage (S3), shared caches into a cache cluster.

### The stateful exception: live updates

Live updates use **WebSockets**: a connection the browser keeps open so the server can push "task 42 moved to done" the moment it happens. A connection lives on one particular server for as long as the board is open, so that part of the system **is** stateful. If Ana is connected to server 1 and Ben moves a task through server 3, server 3 has no direct way to reach Ana.

The standard fix: every server publishes changes to a shared **pub/sub channel** (Redis or a message broker; lesson 7) named after the board, and every server subscribes to the channels of the boards its connected users have open. Server 3 publishes to `board:12`; server 1, subscribed for Ana, receives it and pushes it down her WebSocket. The servers stay interchangeable, and losing one only drops its connections, which the browsers reopen to another server.

> [!plain] In plain English
> If every app server is interchangeable, you can add or remove them freely and lose one without anyone noticing. That only works if none of them is holding onto something important.

## Load balancers

```
clients ──► load balancer ──┬──► app 1
                            ├──► app 2
                            └──► app 3     (health checks remove broken instances)
```

| | L4 (transport) | L7 (application) |
|---|---|---|
| sees | IPs and ports | HTTP: paths, headers, cookies |
| can | forward TCP/UDP very fast | route `/api/*` vs `/` differently, terminate TLS, add headers |
| examples | AWS NLB | AWS ALB, nginx, Envoy, HAProxy (both modes) |

**Algorithms**: round robin (simple), least connections (good when requests vary in cost), weighted (for mixed instance sizes or canaries), consistent hashing on a key (when the same client or key should keep hitting the same backend, e.g. for local caches).

**Health checks**: the balancer polls each instance (for example `GET /health` every 10 seconds) and stops sending traffic to instances that fail, until they pass again. That's what turns "a server died" into "capacity dropped a bit".

A useful health endpoint checks what the instance needs to do its job, and answers **503 Service Unavailable** when it can't. In FastAPI (the framework from the FastAPI track), raising `HTTPException(status_code=503)` sends that status:

```python
from fastapi import FastAPI, HTTPException

app = FastAPI()


@app.get("/health")
def health():
    if not db.ping():                         # can this instance reach the database?
        raise HTTPException(status_code=503)  # take me out of rotation
    return {"status": "ok"}                   # 200: keep sending me traffic
```

Keep it cheap (it runs constantly) and don't fail on optional dependencies: if search is down, the instance can still serve boards.

The load balancer itself must not be a single point of failure: managed balancers (ALB) are redundant internally; self-managed ones run as an active/passive pair with a floating IP.

## Spreading across availability zones

A cloud region is split into **availability zones** (AZs): separate data centers with their own power and networking (the AWS track covers them). Run instances in several zones so a whole zone can fail. Size it from the surviving zones: if the peak needs 12 instances and you use 3 zones, the 2 zones left after a failure must hold all 12, so each zone needs 6, and you run 18 in total. The extra third is the price of surviving a zone outage at peak.

## Autoscaling

Add instances when a metric (CPU, requests per instance, queue depth) passes a target; remove them when it drops. Practical points:

- New instances take time to boot and warm up, so scale **before** saturation (target 50–60% CPU, not 90%).
- Keep a **minimum** that survives losing an availability zone.
- Scheduled scaling handles predictable peaks (Monday 9 a.m.) better than reacting to them.

## CDNs: serving from the edge

A **CDN** (CloudFront, Cloudflare, Fastly) caches responses at hundreds of locations near users. For Taskboard's **static assets** (the JavaScript, CSS, fonts and avatars of the web app) it's standard: they're the same for everyone, so the app tells the CDN how long it may keep them with a response header:

```
Cache-Control: public, max-age=31536000, immutable
```

`public` means shared caches (like a CDN) may store it; `max-age` is how many seconds it stays fresh (here a year, which is safe because each release gets new file names); `immutable` tells browsers not to recheck. Board data is different: it's private to a workspace and changes every second, so API responses get `Cache-Control: private, no-store` and are never cached at the edge. Choosing what may be cached, and for how long, is the trade-off between speed and freshness.

## Multiple regions

Physics: a round trip from Sydney to Virginia is ~200 ms, so a Sydney team loading a board from one US region spends Taskboard's whole 200 ms budget on travel. Options:

- **Read replicas per region** + regional app servers: reads are local, writes go to the primary region (adds latency to changes only).
- **Home region per workspace**: each team's data lives in the region nearest to most of its members; since a workspace is self-contained, almost every request stays in one region.
- **Active-active** multi-region: writes anywhere, replicated asynchronously; needs conflict handling (two people editing the same task in two regions at once).
- **GeoDNS / anycast** routes each user to the nearest healthy region.

Multi-region is expensive and complex; do it when latency or availability requirements demand it, not by default.

:::quiz
q: What makes an app server "stateless"?
+ it keeps no per-user data between requests, so any instance can serve any request
- it has no database
- it doesn't use memory
- it never restarts
why: Statelessness is what lets you add, remove and lose instances freely.
:::

:::quiz
q: Users get logged out randomly after you add a second app server. The likely cause?
+ sessions are stored in each server's memory, and requests alternate between servers
- the load balancer is L4
- the database is too slow
- cookies are disabled
why: Move sessions to a shared store or a signed token.
:::

:::quiz
q: Which load balancer can route `/api/*` and `/static/*` to different backends?
- an L4 load balancer
+ an L7 load balancer
- DNS round robin
- any load balancer
why: Path-based routing requires understanding HTTP.
:::

:::quiz
q: Why can Taskboard's JavaScript bundle be cached at the CDN but board data can't?
+ the bundle is identical for everyone and only changes with a release; board data is private and changes constantly
- CDNs can only cache JavaScript
- board data is too large
- caching JSON is not allowed
why: Edge caching suits public, rarely changing content.
:::

:::exercise
id: ds-stateless
level: 2
title: Where should it live?
mode: answer
---
Taskboard's web app keeps a user's login session in the app server's memory. To scale horizontally, where should sessions go instead: `local disk`, `a shared store like Redis`, or `a bigger server`?
---answer
a shared store like Redis
---answer
redis
---answer
shared store
---solution
a shared store like Redis
:::

:::exercise
id: ds-algo
level: 2
title: Pick an algorithm
mode: answer
---
Taskboard's reporting API has requests that take anywhere from 5 ms to 5 seconds. Which load-balancing algorithm keeps busy servers from piling up: `round robin` or `least connections`?
---answer
least connections
---solution
least connections
:::

:::exercise
id: proj-design-04-instances
level: 3
title: "Project 4: size the app tier"
mode: answer
---
Taskboard's API peaks at **30,000** requests/s. One app instance safely handles **2,500**/s. Taskboard runs in **3** availability zones and must keep full peak capacity if **one whole zone** fails. With instances spread evenly across zones, how many instances in total?
---hint
First: how many instances does the peak need? Those must all fit in the 2 surviving zones.
---answer
18
---solution
18
---explain
30,000 / 2,500 = 12 needed. If one zone fails, the other two must hold 12, so 6 per zone; with 3 zones that's 18 in total.
:::

:::exercise
id: proj-design-04-health
level: 2
title: "Project 4b: a health check for the load balancer"
mode: code
lang: python
file: health.py
path: docs/design/health.py
---
Write the health endpoint from the lesson: `@app.get("/health")` on a function `health()` that raises `HTTPException(status_code=503)` when `db.ping()` returns false, and otherwise returns `{"status": "ok"}`.
---starter
from fastapi import FastAPI, HTTPException

from infra import db

app = FastAPI()
---rule
@app\.get\(\s*["']/health["']\s*\)
`GET /health`
---rule
def\s+health\(\s*\)\s*:
The function
---rule
if\s+not\s+db\.ping\(\s*\)\s*:\s*\n\s+raise\s+HTTPException\(\s*status_code\s*=\s*503\s*\)
503 when the database is unreachable
---rule
return\s*\{\s*["']status["']\s*:\s*["']ok["']\s*\}
`{"status": "ok"}` otherwise
---solution
from fastapi import FastAPI, HTTPException

from infra import db

app = FastAPI()


@app.get("/health")
def health():
    if not db.ping():
        raise HTTPException(status_code=503)
    return {"status": "ok"}
:::

:::exercise
id: proj-design-04-ws
level: 3
title: "Project 4c: reaching Ana"
mode: answer
---
Ana's browser holds a WebSocket to server 1. Ben moves a task through server 3. What do the servers use so server 1 learns about the change and can push it to Ana: `sticky sessions`, `a pub/sub channel per board` or `a bigger server`?
---answer
a pub/sub channel per board
---answer
pub/sub
---answer
pubsub
---answer
a pub/sub channel
---solution
a pub/sub channel per board
---explain
Server 3 publishes to `board:12`; every server with a viewer of board 12 is subscribed and pushes the change down its connections.
:::
