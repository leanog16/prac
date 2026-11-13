---
id: design-reliability
title: Reliability & resilience
summary: Failure as the normal case, redundancy and failover, timeouts, retries with exponential backoff and jitter, circuit breakers, bulkheads, rate limiting with token buckets, load shedding and graceful degradation, health checks, and disaster recovery with RPO and RTO.
minutes: 40
---
> [!project] Snip, step 8: staying up when things break
> At Snip's scale something is always failing: a disk, an instance, a dependency, a network link. This step makes failure routine: timeouts and retries for the database, a circuit breaker for the analytics broker, a rate limiter against abuse, and a recovery plan for losing a whole region.

## Everything fails

At scale, failures are **statistics**, not surprises. With 1,000 disks at a 2% annual failure rate, you replace one every couple of weeks. The question isn't "will it fail?" but "what happens when it does?"

Design principles:

- **No single points of failure**: at least two of everything on the critical path, in different availability zones.
- **Fail fast**: a quick error beats a hanging request that ties up resources.
- **Contain failures**: one broken dependency shouldn't take everything down.
- **Degrade gracefully**: serve what you can.

## Timeouts

Every network call needs a timeout. Without one, a hung dependency holds your threads or connections until they run out, and your service hangs too: a **cascading failure**.

Set timeouts from the dependency's normal latency (e.g. p99 × 2–3) and your own deadline. If Snip promises a 50 ms redirect, a 2-second database timeout makes no sense; 20–30 ms with a fallback does.

## Retries with backoff and jitter

Transient failures (a dropped connection, a brief 503) often succeed on retry. But naive retries make outages worse: every client retrying immediately multiplies load on a struggling service.

```python
import random, time

def call_with_retries(fn, attempts=4, base=0.1, cap=2.0):
    for attempt in range(attempts):
        try:
            return fn()
        except TransientError:
            if attempt == attempts - 1:
                raise
            delay = min(cap, base * 2 ** attempt)          # 0.1, 0.2, 0.4, 0.8 …
            time.sleep(random.uniform(0, delay))           # "full jitter"
```

- **Exponential backoff** spreads retries out over time.
- **Jitter** (randomness) stops thousands of clients from retrying in synchronized waves.
- Only retry **idempotent** operations (or use idempotency keys), and only **transient** errors: retrying a 400 is pointless.
- Retries multiply across layers: 3 retries at each of 3 layers = up to 27 attempts. Retry at one layer.

## Circuit breakers

When a dependency is clearly down, stop calling it for a while:

```
CLOSED ──(failures exceed threshold)──► OPEN ──(after a cooldown)──► HALF-OPEN
   ▲                                     (fail fast,                    │
   └──────────(trial requests succeed)───  use fallback)  ◄──(trial fails)┘
```

Snip wraps its analytics publisher in a breaker: if the broker is down, redirects **skip** publishing (or buffer locally) instead of waiting on timeouts. Redirects keep working; some click counts are lost or delayed. That's graceful degradation.

## Bulkheads

Separate resource pools per dependency (thread pools, connection pools, even separate service instances), like the watertight compartments of a ship. A slow analytics backend can then exhaust only its own pool, not the threads that serve redirects.

## Rate limiting

Protect Snip from abuse (bots creating millions of links, scanners probing codes) and from any single client using everything. The **token bucket** is the standard algorithm:

- Each client has a bucket of up to `capacity` tokens, refilled at `rate` tokens per second.
- Each request takes one token; with none left, the request is rejected with **429 Too Many Requests** and a `Retry-After` header.
- Bursts up to `capacity` are allowed; the long-run average is limited to `rate`.

In a fleet of servers, keep the counters in a shared store (Redis, with atomic scripts), or rate-limit at the API gateway or load balancer.

> [!plain] In plain English
> A token bucket is an allowance: you get a few tokens per second, can save up a handful for bursts, and each request spends one.

## Load shedding and degradation

When overloaded, reject some work early (fast 503s for low-priority requests) so the important work succeeds, instead of everything slowing until it all times out. Decide in advance what's essential: for Snip, redirects > link creation > analytics dashboards.

## Disaster recovery: RPO and RTO

| Term | Question | Snip target |
|---|---|---|
| **RPO** (recovery point objective) | how much data can we lose? | ≤ 1 minute of new links |
| **RTO** (recovery time objective) | how long can we be down? | ≤ 15 minutes for redirects |

Strategies from cheapest to most resilient: backups restored elsewhere (RPO hours, RTO hours) → pilot light (minimal standby infrastructure in a second region) → warm standby (scaled-down copy, continuous replication) → active-active (both regions serve traffic). And **test** the recovery: an untested backup is a hope, not a plan.

:::quiz
q: Why add jitter to retry delays?
+ so many clients don't retry in synchronized waves that overload the recovering service
- to make retries faster
- to guarantee success
- because exponential backoff alone is too slow
why: Randomness spreads retries out.
:::

:::quiz
q: Which errors should generally be retried?
+ transient ones like timeouts and 503s, for idempotent operations
- 400 Bad Request
- 404 Not Found
- every error
why: Retrying permanent errors only adds load.
:::

:::quiz
q: What does an open circuit breaker do?
+ fails calls immediately (or uses a fallback) without contacting the failing dependency
- retries faster
- queues all calls
- restarts the dependency
why: It stops wasting time and resources on a dependency that's down.
:::

:::quiz
q: A token bucket has capacity 10 and refills 2 tokens per second. A client sends 15 requests at once after being idle. How many are allowed immediately?
- 2
+ 10
- 15
- 0
why: The bucket holds at most 10 tokens; the other 5 are rejected (or must wait).
:::

:::exercise
id: dr-backoff
level: 3
title: Backoff with full jitter
mode: code
lang: python
file: retry.py
---
Write `backoff_delay(attempt: int, base: float = 0.1, cap: float = 2.0) -> float` returning `random.uniform(0, min(cap, base * 2 ** attempt))`.
---starter
import random
---rule
def\s+backoff_delay\(\s*attempt\s*:\s*int\s*,\s*base\s*:\s*float\s*=\s*0\.1\s*,\s*cap\s*:\s*float\s*=\s*2\.0\s*\)
The signature
---rule
min\(\s*cap\s*,\s*base\s*\*\s*2\s*\*\*\s*attempt\s*\)
Exponential, capped
---rule
random\.uniform\(\s*0\s*,\s*min\(
Full jitter
---solution
import random


def backoff_delay(attempt: int, base: float = 0.1, cap: float = 2.0) -> float:
    return random.uniform(0, min(cap, base * 2 ** attempt))
:::

:::exercise
id: dr-predict-backoff
level: 2
title: Predict: the cap
mode: answer
---
With `base = 0.1` and `cap = 2.0`, what is the **maximum** possible delay for `attempt = 6`?
---answer
2
---answer
2.0
---solution
2.0
---explain
0.1 × 2⁶ = 6.4, capped at 2.0.
:::

:::exercise
id: proj-design-08-bucket
level: 4
title: "Project 8: Snip's token bucket"
mode: code
lang: python
file: ratelimit.py
---
Implement `TokenBucket.allow()`: compute `now = time.monotonic()`, add `(now - self.updated) * self.rate` tokens (capped at `self.capacity`), set `self.updated = now`; then if at least 1 token is available, subtract 1 and return `True`, otherwise return `False`.
---starter
import time


class TokenBucket:
    def __init__(self, capacity: float, rate: float):
        self.capacity = capacity
        self.rate = rate
        self.tokens = capacity
        self.updated = time.monotonic()

    def allow(self) -> bool:
        ...
---rule
now\s*=\s*time\.monotonic\(\s*\)
Use a monotonic clock
---rule
self\.tokens\s*=\s*min\(\s*self\.capacity\s*,\s*self\.tokens\s*\+\s*\(\s*now\s*-\s*self\.updated\s*\)\s*\*\s*self\.rate\s*\)
Refill, capped at capacity
---rule
self\.updated\s*=\s*now
Remember the time
---rule
if\s+self\.tokens\s*>=\s*1\s*:\s*\n\s+self\.tokens\s*-=\s*1\s*\n\s+return\s+True
Spend a token
---rule
return\s+False
Reject when empty
---solution
import time


class TokenBucket:
    def __init__(self, capacity: float, rate: float):
        self.capacity = capacity
        self.rate = rate
        self.tokens = capacity
        self.updated = time.monotonic()

    def allow(self) -> bool:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False
:::

:::exercise
id: proj-design-08-breaker
level: 4
title: "Project 8b: a circuit breaker"
mode: code
lang: python
file: breaker.py
---
Complete `CircuitBreaker.call(fn)`: if `self.opened_at` is set and fewer than `self.cooldown` seconds have passed (`time.monotonic() - self.opened_at < self.cooldown`), raise `CircuitOpen()`. Otherwise try `result = fn()`; on success reset `self.failures = 0` and `self.opened_at = None` and return the result; on `Exception`, increment `self.failures`, and if it reaches `self.threshold`, set `self.opened_at = time.monotonic()`; then re-raise.
---starter
import time


class CircuitOpen(Exception):
    pass


class CircuitBreaker:
    def __init__(self, threshold: int = 5, cooldown: float = 30.0):
        self.threshold = threshold
        self.cooldown = cooldown
        self.failures = 0
        self.opened_at = None

    def call(self, fn):
        ...
---rule
if\s+self\.opened_at\s+is\s+not\s+None\s+and\s+time\.monotonic\(\s*\)\s*-\s*self\.opened_at\s*<\s*self\.cooldown\s*:\s*\n\s+raise\s+CircuitOpen\(\s*\)
Fail fast while open
---rule
try\s*:\s*\n\s+result\s*=\s*fn\(\s*\)
Try the call
---rule
except\s+Exception\s*:[\s\S]*?self\.failures\s*\+=\s*1
Count failures
---rule
if\s+self\.failures\s*>=\s*self\.threshold\s*:\s*\n\s+self\.opened_at\s*=\s*time\.monotonic\(\s*\)
Open after the threshold
---rule
^\s+raise\s*$
Re-raise the error
---rule
self\.failures\s*=\s*0[\s\S]*?self\.opened_at\s*=\s*None[\s\S]*?return\s+result|self\.opened_at\s*=\s*None[\s\S]*?self\.failures\s*=\s*0[\s\S]*?return\s+result
Reset on success
---solution
import time


class CircuitOpen(Exception):
    pass


class CircuitBreaker:
    def __init__(self, threshold: int = 5, cooldown: float = 30.0):
        self.threshold = threshold
        self.cooldown = cooldown
        self.failures = 0
        self.opened_at = None

    def call(self, fn):
        if self.opened_at is not None and time.monotonic() - self.opened_at < self.cooldown:
            raise CircuitOpen()
        try:
            result = fn()
        except Exception:
            self.failures += 1
            if self.failures >= self.threshold:
                self.opened_at = time.monotonic()
            raise
        self.failures = 0
        self.opened_at = None
        return result
:::

:::exercise
id: proj-design-08-rpo
level: 2
title: "Project 8c: RPO or RTO?"
mode: answer
---
"After losing the primary region, Snip must be redirecting again within 15 minutes." Is that an RPO or an RTO?
---answer
RTO
---solution
RTO
:::
