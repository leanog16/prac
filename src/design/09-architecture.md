---
id: design-architecture
title: Architecture styles
summary: Monoliths, modular monoliths and microservices with honest trade-offs, service boundaries and domain-driven design, layered and hexagonal architecture, synchronous vs asynchronous communication between services, API gateways, sagas for distributed workflows, observability (logs, metrics, traces), and documenting decisions with ADRs.
minutes: 40
---
> [!project] Snip, step 9: how should the code be organized?
> Snip has grown: link management, redirects, analytics, billing for premium accounts, and an admin console. The team wonders whether to split it into microservices. This step weighs the options and decides where the boundaries should be.

## Monolith, modular monolith, microservices

| | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| deployment | one unit | one unit | many independent units |
| internal boundaries | often blurry | enforced modules with clear interfaces | network boundaries |
| calls between parts | function calls | function calls | network calls (latency, failures) |
| data | one database | one database, schema per module | a database per service |
| scaling | the whole app | the whole app | each service independently |
| team fit | small teams | small to medium teams | many teams owning services end to end |
| operational cost | low | low | high: deployment pipelines, observability, network failures, versioning |

**Microservices solve organizational problems** (many teams stepping on each other) at the price of **distributed-systems problems**. For a small team, a well-structured **modular monolith** is usually the best start; extract a service when there's a concrete reason: a part with very different scaling needs, a different release cadence, or a separate team.

For Snip, one concrete reason exists: the **redirect path** has extreme scale and availability needs (99.99%, 10k+/s) that the rest doesn't. Extracting a tiny, independently deployed **redirect service** (reading from the cache and a replica) protects it from the bugs and deployments of everything else. The rest stays a modular monolith.

> [!plain] In plain English
> Splitting an app into many services makes each piece simpler and lets teams work independently, but turns every function call into a network call that can be slow or fail. Only pay that price when you get something real for it.

## Finding boundaries

Good boundaries follow the **domain**, not technical layers. **Domain-driven design** calls them *bounded contexts*: areas with their own language and model.

| Snip context | Owns | Talks to others via |
|---|---|---|
| Links | create, edit, expire links | publishes `link.created`, `link.deleted` |
| Redirect | code → URL at high speed | reads a replica/cache; publishes `link.clicked` |
| Analytics | click aggregates, reports | consumes `link.clicked` |
| Accounts & billing | users, plans, payments | publishes `plan.changed` |

A boundary is good when most changes stay inside one context, and contexts share **events and APIs**, never each other's database tables.

## Inside a service: layers and hexagons

**Layered**: controllers → services → repositories. Simple and common (it's the Spring and FastAPI structure from earlier tracks).

**Hexagonal** ("ports and adapters"): the domain logic is in the center and depends on nothing; it defines **ports** (interfaces) like `LinkRepository` and `EventPublisher`; **adapters** implement them (PostgreSQL, Kafka, HTTP controllers). The payoff is that the core can be tested without any infrastructure, and infrastructure can be swapped. It's dependency inversion (the Java track's "D" in SOLID) applied to a whole service.

## Communication between services

| | Synchronous (HTTP/gRPC) | Asynchronous (events) |
|---|---|---|
| coupling | caller needs callee **up** right now | producer doesn't know or wait for consumers |
| latency | adds up along the call chain | caller returns immediately |
| consistency | immediate | eventual |
| good for | queries that need an answer now | notifying others that something happened |

Long chains of synchronous calls are fragile: availability multiplies (lesson 1) and latencies add. Prefer events for "something happened", and keep synchronous calls for "I need an answer".

## Distributed workflows: sagas

Without a shared database, there's no single transaction across services. A **saga** runs a sequence of local transactions, each publishing an event that triggers the next, with **compensating actions** to undo earlier steps if a later one fails. For example, upgrading a plan: charge the card → enable premium features; if enabling fails, refund the charge.

## API gateway

A single entry point in front of services: routing, authentication, rate limiting, TLS, request logging. It keeps those concerns out of every service. Keep business logic **out** of the gateway.

## Observability

With many components, you need to answer "what's wrong and where?" quickly:

- **Logs**: structured (JSON), with a **request/trace ID** on every line.
- **Metrics**: rates, errors, durations (the "RED" method) and saturation, with alerts on SLOs.
- **Traces**: one request followed across services (OpenTelemetry), showing where time goes.

## Architecture decision records

Write each significant decision down in a short **ADR**: context, decision, alternatives considered, consequences. "Why is the redirect service separate?" should have a one-page answer in the repository, not depend on who's still at the company.

:::quiz
q: What is the main problem microservices solve?
+ letting many teams develop, deploy and scale parts of a system independently
- making a small app faster
- reducing operational complexity
- avoiding the need for databases
why: Their benefits are mostly organizational; their costs are technical.
:::

:::quiz
q: Two services read and write the same database tables. What's the main problem?
+ they're coupled through the schema: neither can change its data model independently
- it's slower
- it's impossible with PostgreSQL
- nothing
why: Services should share APIs and events, not tables.
:::

:::quiz
q: What does a saga use instead of a distributed transaction?
+ a sequence of local transactions with compensating actions for failures
- two-phase commit across all services
- a single shared database
- retries only
why: Each step is local; compensations undo earlier steps.
:::

:::quiz
q: In hexagonal architecture, what does the domain core depend on?
+ only its own ports (interfaces), not on databases or frameworks
- the database driver directly
- the HTTP framework
- the message broker client
why: Adapters depend on the core, not the other way around.
:::

:::exercise
id: dar-sync
level: 2
title: Sync or async?
mode: answer
---
When a link is deleted, Analytics should stop showing it, and the cache should drop it. Should the Links service call those services synchronously, or publish an event? Answer `sync` or `event`.
---answer
event
---solution
event
:::

:::exercise
id: dar-chain
level: 3
title: Chained availability
mode: answer
---
A request synchronously calls 4 services in sequence, each 99.9% available. What's the best-case availability of the whole request, as a percentage with one decimal?
---answer
99.6
---answer
99.6%
---solution
99.6
---explain
0.999⁴ ≈ 0.996.
:::

:::exercise
id: proj-design-09-port
level: 3
title: "Project 9: a port and an adapter"
mode: code
lang: python
file: links_core.py
---
Define a port `class LinkRepository(Protocol)` with methods `def get(self, code: str) -> str | None: ...` and `def put(self, code: str, url: str) -> None: ...`. Then write the core service `class LinkService` whose `__init__(self, repo: LinkRepository)` stores the repository, and `resolve(self, code: str)` returns `self.repo.get(code)`. The core must not import any database library.
---starter
from typing import Protocol
---rule
class\s+LinkRepository\(\s*Protocol\s*\)\s*:
The port
---rule
def\s+get\(\s*self\s*,\s*code\s*:\s*str\s*\)\s*->\s*(str\s*\|\s*None|Optional\[\s*str\s*\])\s*:\s*\.\.\.
`get`
---rule
def\s+put\(\s*self\s*,\s*code\s*:\s*str\s*,\s*url\s*:\s*str\s*\)\s*->\s*None\s*:\s*\.\.\.
`put`
---rule
class\s+LinkService\s*:
The core service
---rule
def\s+__init__\(\s*self\s*,\s*repo\s*:\s*LinkRepository\s*\)\s*:\s*\n\s+self\.repo\s*=\s*repo
Depends on the port
---rule
def\s+resolve\(\s*self\s*,\s*code\s*:\s*str\s*\)[^\n]*:\s*\n\s+return\s+self\.repo\.get\(\s*code\s*\)
`resolve` uses the port
---rule
!import\s+(psycopg|sqlalchemy|redis|boto3)
No infrastructure imports
---solution
from typing import Protocol


class LinkRepository(Protocol):
    def get(self, code: str) -> str | None: ...
    def put(self, code: str, url: str) -> None: ...


class LinkService:
    def __init__(self, repo: LinkRepository):
        self.repo = repo

    def resolve(self, code: str) -> str | None:
        return self.repo.get(code)
:::

:::exercise
id: proj-design-09-adr
level: 3
title: "Project 9b: write the ADR"
mode: code
lang: yaml
file: adr-001.yaml
---
Record the decision as a YAML ADR with keys: `title: Separate redirect service`, `status: accepted`, `context` (any text), `decision` (any text), an `alternatives` list with at least **two** items, and a `consequences` list with at least **two** items.
---starter
# ADR 001
---rule
^title:\s*["']?Separate redirect service["']?\s*$
Title
---rule
^status:\s*["']?accepted["']?\s*$
Status
---rule
^context:\s*\S
Context
---rule
^decision:\s*\S
Decision
---rule
^alternatives:\s*\n(\s+-\s+.+\n){2,}
Two or more alternatives
---rule
^consequences:\s*\n(\s+-\s+.+(\n|$)){2,}
Two or more consequences
---solution
title: Separate redirect service
status: accepted
context: Redirects need 99.99% availability and 10k+ requests per second; the rest of Snip deploys daily.
decision: Extract redirects into a small service that reads from the cache and a read replica.
alternatives:
  - keep everything in the modular monolith
  - full microservices for every context
consequences:
  - redirects are isolated from other deployments and bugs
  - one more service to deploy, monitor and version
:::
