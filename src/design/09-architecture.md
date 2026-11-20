---
id: design-architecture
title: Architecture styles
summary: Monoliths, modular monoliths and microservices with honest trade-offs, service boundaries and domain-driven design, layered and hexagonal architecture, synchronous vs asynchronous communication between services, API gateways, sagas for distributed workflows, observability (logs, metrics, traces), and documenting decisions with ADRs.
minutes: 40
---
> [!project] Taskboard, step 9: how should the code be organized?
> Taskboard has grown: boards and tasks, live updates, notifications, search, billing for paid plans, and an admin console. The team wonders whether to split it into microservices. This step weighs the options, decides where the boundaries should be, and writes the decision down.

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

For Taskboard, one concrete reason exists: **live updates** behave nothing like the rest. They hold hundreds of thousands of long-lived WebSocket connections, scale with *open browser tabs* rather than requests, and every deployment of the main app would drop all of those connections. Extracting a small, independently deployed **realtime service** (it subscribes to board events and pushes them to browsers; lesson 4) protects it from the deployments of everything else, and lets it scale on its own metric. The rest stays a modular monolith.

> [!plain] In plain English
> Splitting an app into many services makes each piece simpler and lets teams work independently, but turns every function call into a network call that can be slow or fail. Only pay that price when you get something real for it.

## Finding boundaries

Good boundaries follow the **domain**, not technical layers. **Domain-driven design** calls them *bounded contexts*: areas with their own language and model.

| Taskboard context | Owns | Talks to others via |
|---|---|---|
| Boards & tasks | workspaces, boards, tasks, comments | publishes `task.created`, `task.moved`, `task.assigned` |
| Realtime | WebSocket connections | consumes task events; pushes them to browsers |
| Notifications | preferences, emails, push | consumes `task.assigned`, `comment.mentioned` |
| Search | the full-text index | consumes task events |
| Accounts & billing | users, plans, payments | publishes `plan.changed` |

A boundary is good when most changes stay inside one context, and contexts share **events and APIs**, never each other's database tables.

## Inside a service: layers and hexagons

**Layered**: controllers → services → repositories. Simple and common (it's the Spring and FastAPI structure from earlier tracks).

**Hexagonal** ("ports and adapters"): the domain logic is in the center and depends on nothing; it defines **ports** (interfaces) like `TaskRepository` and `EventPublisher`; **adapters** implement them (PostgreSQL, Kafka, HTTP controllers). The payoff is that the core can be tested without any infrastructure, and infrastructure can be swapped. It's dependency inversion (the Java track's "D" in SOLID) applied to a whole service.

In Python, a port is a `typing.Protocol`: a class that only lists method signatures. Any class with matching methods satisfies it, without inheriting from it. `...` (an ellipsis) stands in for a body that doesn't exist yet:

```python
from typing import Protocol


class TaskRepository(Protocol):                       # the port
    def get(self, task_id: int) -> dict | None: ...
    def save(self, task: dict) -> None: ...


class TaskService:                                    # the core: no database imports
    def __init__(self, repo: TaskRepository):
        self.repo = repo                              # any adapter can be passed in

    def find(self, task_id: int) -> dict | None:
        return self.repo.get(task_id)


class PostgresTaskRepository:                         # an adapter (lives elsewhere)
    def get(self, task_id: int) -> dict | None: ...   # real SQL here
    def save(self, task: dict) -> None: ...
```

In tests, pass an in-memory fake repository; in production, the PostgreSQL adapter. The core never changes.

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

Write each significant decision down in a short **ADR** (architecture decision record) in the repository: a title, a status (`proposed`, `accepted`, later perhaps `superseded`), the **context** (the forces at play), the **decision**, the **alternatives** considered, and the **consequences**, good and bad. "Why is the realtime service separate?" should have a one-page answer in the repository, not depend on who's still at the company. Taskboard writes ADRs in the same YAML style as its other design notes (lesson 1):

```yaml
title: Use cursor pagination for boards
status: accepted
context: Boards can hold thousands of tasks and change while people scroll.
decision: Board listings return a next_cursor instead of accepting offsets.
alternatives:
  - offset and limit
  - return the whole board
consequences:
  - pages stay fast and stable at any depth
  - clients can't jump straight to page 40
```

Short text values can be written without quotes, as long as they contain no `: ` (colon followed by a space) and don't start with a symbol such as `-`, `[` or `#`.

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
When a task is deleted, Search should drop it from the index and Realtime should remove it from open boards. Should the Boards & tasks context call those services synchronously, or publish an event? Answer `sync` or `event`.
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
file: tasks_core.py
path: docs/design/tasks_core.py
---
Define the port `class TaskRepository(Protocol)` with methods `def get(self, task_id: int) -> dict | None: ...` and `def save(self, task: dict) -> None: ...`. Then write the core `class TaskService` whose `__init__(self, repo: TaskRepository)` stores the repository as `self.repo`, and whose `find(self, task_id: int)` returns `self.repo.get(task_id)`. The core must not import any database library.
---starter
from typing import Protocol
---hint
The lesson's "Inside a service" section shows the same shape; you need the port and the core, not the adapter.
---rule
class\s+TaskRepository\(\s*Protocol\s*\)\s*:
The port
---rule
def\s+get\(\s*self\s*,\s*task_id\s*:\s*int\s*\)\s*->\s*(dict\s*\|\s*None|Optional\[\s*dict\s*\])\s*:\s*\.\.\.
`get`
---rule
def\s+save\(\s*self\s*,\s*task\s*:\s*dict\s*\)\s*->\s*None\s*:\s*\.\.\.
`save`
---rule
class\s+TaskService\s*:
The core service
---rule
def\s+__init__\(\s*self\s*,\s*repo\s*:\s*TaskRepository\s*\)\s*:\s*\n\s+self\.repo\s*=\s*repo
Depends on the port
---rule
def\s+find\(\s*self\s*,\s*task_id\s*:\s*int\s*\)[^\n]*:\s*\n\s+return\s+self\.repo\.get\(\s*task_id\s*\)
`find` uses the port
---rule
!import\s+(psycopg|sqlalchemy|redis|boto3|sqlmodel)
No infrastructure imports
---solution
from typing import Protocol


class TaskRepository(Protocol):
    def get(self, task_id: int) -> dict | None: ...
    def save(self, task: dict) -> None: ...


class TaskService:
    def __init__(self, repo: TaskRepository):
        self.repo = repo

    def find(self, task_id: int) -> dict | None:
        return self.repo.get(task_id)
:::

:::exercise
id: proj-design-09-adr
level: 3
title: "Project 9b: write the ADR"
mode: code
lang: yaml
file: adr-001.yaml
path: docs/design/adr-001-realtime.yaml
---
Record the realtime decision as a YAML ADR, in the shape of the lesson's example: `title: Separate realtime service`, `status: accepted`, `context` (any text), `decision` (any text), an `alternatives` list with at least **two** items, and a `consequences` list with at least **two** items.
---starter
# ADR 001
---rule
^title:\s*["']?Separate realtime service["']?\s*$
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
title: Separate realtime service
status: accepted
context: Live updates hold hundreds of thousands of WebSocket connections and every deployment of the main app drops them.
decision: Extract a realtime service that consumes task events and pushes them to browsers.
alternatives:
  - keep WebSockets in the modular monolith
  - make every context a microservice
consequences:
  - deployments of the main app no longer drop live connections
  - one more service to deploy, monitor and version
:::
