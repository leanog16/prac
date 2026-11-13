---
id: design-scaling
title: Scaling the stateless tier
summary: Vertical vs horizontal scaling, why stateless servers scale and stateful ones don't, where session state should live, load balancers (L4 vs L7, algorithms, health checks), autoscaling, CDNs and edge caching, and serving users in several regions.
minutes: 35
---
> [!project] Snip, step 4: from one box to many
> Snip v1 is one server running the app and the database. It handles a few hundred redirects per second. This step takes the **app tier** to 10,000+ per second: many identical servers behind a load balancer, with a CDN in front.

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

A server is **stateless** when any request can go to any instance, because nothing about the user is kept in that server's memory or disk between requests. Snip's redirect is naturally stateless: look up the code, return a redirect.

What breaks statelessness:

- **in-memory sessions** ("user 42 is logged in" stored in one server's RAM): the next request lands elsewhere and the user is logged out;
- **local file uploads**: the file lives on one server only;
- **in-process caches** that must be consistent: each server has a different copy.

Move that state **out** of the app servers: sessions into a shared store (Redis) or into signed tokens (JWTs) carried by the client, files into object storage (S3), shared caches into a cache cluster.

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

**Health checks**: the balancer polls each instance (`GET /health`) and stops sending traffic to failing ones. That's what turns "a server died" into "capacity dropped a bit".

The load balancer itself must not be a single point of failure: managed balancers (ALB) are redundant internally; self-managed ones run as an active/passive pair with a floating IP.

## Autoscaling

Add instances when a metric (CPU, requests per instance, queue depth) passes a target; remove them when it drops. Practical points:

- New instances take time to boot and warm up, so scale **before** saturation (target 50–60% CPU, not 90%).
- Keep a **minimum** that survives losing an availability zone.
- Scheduled scaling handles predictable peaks (Monday 9 a.m.) better than reacting to them.

## CDNs: serving from the edge

A **CDN** (CloudFront, Cloudflare, Fastly) caches responses at hundreds of locations near users. For static assets it's standard. For Snip, even **redirects** can be cached at the edge with a short TTL:

```
Cache-Control: public, max-age=300
```

A popular link is then answered by the CDN in a few milliseconds without touching Snip's servers at all. The trade-off: edge-cached redirects aren't counted by Snip (analytics must come from CDN logs), and changes take up to 5 minutes to propagate.

## Multiple regions

Physics: a round trip from Sydney to Virginia is ~200 ms, so Snip's 50 ms p99 is impossible from one region. Options:

- **Read replicas per region** + regional app servers: reads are local, writes go to the primary region (adds latency to link creation only).
- **Active-active** multi-region: writes anywhere, replicated asynchronously; needs conflict handling (for Snip, random codes make conflicts rare).
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
q: What's the trade-off of caching Snip's redirects at the CDN?
+ much faster and cheaper redirects, but Snip's servers don't see those clicks and changes take up to the TTL to apply
- redirects become slower
- the CDN can't cache redirects
- links stop expiring permanently
why: Edge caching trades freshness and visibility for speed.
:::

:::exercise
id: ds-stateless
level: 2
title: Where should it live?
mode: answer
---
Snip's dashboard keeps a user's login session in the app server's memory. To scale horizontally, where should sessions go instead: `local disk`, `a shared store like Redis`, or `a bigger server`?
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
Snip's analytics API has requests that take anywhere from 5 ms to 5 seconds. Which load-balancing algorithm keeps busy servers from piling up: `round robin` or `least connections`?
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
Snip's peak is **12,000** redirects/s. One app instance safely handles **1,500**/s. Snip runs in **3** availability zones and must keep full peak capacity if **one whole zone** fails. With instances spread evenly across zones, how many instances in total? (Hint: compute what's needed in the 2 surviving zones, then spread across 3.)
---answer
12
---solution
12
---explain
12,000 / 1,500 = 8 needed. If one zone fails, the other two must hold 8, so 4 per zone; with 3 zones that's 12 in total.
:::

:::exercise
id: proj-design-04-cache-header
level: 2
title: "Project 4b: an edge-cacheable redirect"
mode: code
lang: python
file: redirect.py
---
Write the FastAPI redirect endpoint `GET /{code}`: look up `url = lookup(code)`; if it's `None` raise `HTTPException(404)`; otherwise return `RedirectResponse(url, status_code=302, headers={"Cache-Control": "public, max-age=300"})`.
---starter
from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse

from store import lookup

app = FastAPI()
---rule
@app\.get\(\s*["']/\{code\}["']\s*\)
`GET /{code}`
---rule
url\s*=\s*lookup\(\s*code\s*\)
Look up the code
---rule
if\s+url\s+is\s+None\s*:\s*\n\s+raise\s+HTTPException\(\s*(status_code\s*=\s*)?404
404 for unknown codes
---rule
RedirectResponse\(\s*url\s*,\s*status_code\s*=\s*302
A 302 redirect
---rule
["']Cache-Control["']\s*:\s*["']public, max-age=300["']
Cacheable for 5 minutes
---solution
from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse

from store import lookup

app = FastAPI()


@app.get("/{code}")
def redirect(code: str):
    url = lookup(code)
    if url is None:
        raise HTTPException(status_code=404)
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "public, max-age=300"})
:::
