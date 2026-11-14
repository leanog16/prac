---
id: fastapi-async
title: Async, WebSockets & async databases
summary: How the event loop really works, the blocking-call trap and how to escape it (def routes, run_in_threadpool, asyncio.to_thread), concurrent I/O with asyncio.gather and httpx.AsyncClient, WebSockets and a broadcast manager, and SQLAlchemy's AsyncSession.
minutes: 40
---
> [!project] Taskboard, step 12: a live board
> When a teammate moves a task, everyone else's board should update instantly. This step adds a WebSocket that broadcasts task events, and a webhook call to a chat tool that runs without blocking the API.

## One thread, many requests

An `async def` route runs on the **event loop**: a single thread that juggles many requests by switching between them whenever one is **waiting** (`await`) for the network, the database or a timer. While request A awaits a database reply, the loop serves requests B, C and D. That's how one process handles thousands of concurrent connections.

The catch: the loop can only switch at an `await`. Code that blocks without awaiting **freezes every request on that worker**.

```python
import time, asyncio

@app.get("/bad")
async def bad():
    time.sleep(2)          # blocks the whole event loop for 2 s: every other request waits
    return {"ok": True}


@app.get("/good")
async def good():
    await asyncio.sleep(2)  # yields to the loop; other requests keep flowing
    return {"ok": True}
```

## def vs async def, precisely

| You write | FastAPI runs it | Use it when |
|---|---|---|
| `async def` | directly on the event loop | everything inside is non-blocking (`await`-able libraries: httpx, asyncpg, `AsyncSession`, aioredis) |
| `def` | in a **thread pool**, so it doesn't block the loop | you call blocking libraries (`requests`, `psycopg2`, the sync SQLAlchemy `Session`, file I/O, `boto3`) |

So a plain `def` route that calls `requests.get()` is **fine**. An `async def` route that calls `requests.get()` is the classic FastAPI performance bug. When in doubt, `def` is the safe default. Dependencies follow the same rule.

## Escaping a blocking call inside async code

Sometimes you're in an `async def` and must call something blocking (a sync SDK, a CPU-heavy function). Push it off the loop:

```python
import asyncio
from fastapi.concurrency import run_in_threadpool


@app.get("/thumbnail/{image_id}")
async def thumbnail(image_id: int):
    raw = await storage.download(image_id)            # async I/O
    thumb = await asyncio.to_thread(make_thumbnail, raw)   # blocking CPU work in a thread
    # equivalent: thumb = await run_in_threadpool(make_thumbnail, raw)
    return Response(thumb, media_type="image/png")
```

Threads help with blocking **I/O**. Heavy CPU work in Python still competes for the GIL, so for real number crunching use a process pool or a task queue (Celery, arq, RQ) and run several worker processes.

## Doing I/O concurrently

`await` one call after another and the latencies add up. `asyncio.gather` runs them **at the same time**:

```python
import asyncio
import httpx


async def fetch_dashboard(client: httpx.AsyncClient, user_id: int):
    profile, orders, notes = await asyncio.gather(
        client.get(f"https://users.internal/users/{user_id}"),
        client.get(f"https://orders.internal/orders?user={user_id}"),
        client.get(f"https://notes.internal/notes?user={user_id}"),
    )
    return {"profile": profile.json(), "orders": orders.json(), "notes": notes.json()}
```

Three 100 ms calls take about 100 ms total instead of 300 ms. Create **one** `httpx.AsyncClient` in the lifespan and reuse it: it keeps a connection pool, so you skip the TCP and TLS handshakes. Always set a timeout (`httpx.AsyncClient(timeout=5)`), because a hung upstream otherwise hangs your request forever.

## WebSockets

A **WebSocket** starts as an HTTP request and then upgrades to a persistent, **two-way** connection. Either side can send at any time. Use it for chat, collaborative editing, live dashboards and multiplayer games:

```python
from fastapi import WebSocket, WebSocketDisconnect


@app.websocket("/ws/echo")
async def echo(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            text = await websocket.receive_text()
            await websocket.send_text(f"echo: {text}")
    except WebSocketDisconnect:
        pass                     # client went away; clean up here
```

- Call `await websocket.accept()` first, or the handshake fails.
- `receive_text` / `receive_json` / `receive_bytes` and the matching `send_*` methods.
- Path and query parameters and `Depends` work as in HTTP routes. Browsers can't set custom headers on WebSockets, so authentication can use secure cookies or a short-lived credential in the first message. Query-string tokens may be logged, so avoid long-lived credentials there.
- To reject a connection, `await websocket.close(code=1008)` (1008 = policy violation).

### Broadcasting to many clients

```python
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, message: str):
        for ws in self.active:
            await ws.send_text(message)


manager = ConnectionManager()


@app.websocket("/ws/chat/{room}")
async def chat(websocket: WebSocket, room: str):
    await manager.connect(websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            await manager.broadcast(f"[{room}] {msg}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
```

> [!warn] In-memory state doesn't scale out
> `manager.active` lives in **one** process. With 4 uvicorn workers or 3 containers, a message only reaches clients connected to the same process. Real deployments fan messages out through a broker (Redis pub/sub, NATS) so every worker can deliver events to its own connected clients.

Test WebSockets with TestClient:

```python
def test_echo():
    with client.websocket_connect("/ws/echo") as ws:
        ws.send_text("hi")
        assert ws.receive_text() == "echo: hi"
```

## Async databases with SQLAlchemy

The sync `Session` from the database lesson blocks, so it belongs in `def` routes. For `async def` routes, use SQLAlchemy's **async engine** with an async driver (`asyncpg` for PostgreSQL, `aiosqlite` for SQLite):

```python title=db.py
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

engine = create_async_engine("postgresql+asyncpg://app:secret@db/app", pool_size=10)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session():
    async with SessionLocal() as session:
        yield session
```

```python title=routes.py
from sqlalchemy import select


@app.get("/products/{product_id}")
async def get_product(product_id: int, session: Annotated[AsyncSession, Depends(get_session)]):
    product = await session.get(Product, product_id)
    if product is None:
        raise HTTPException(404, "Product not found")
    return product


@app.get("/products")
async def list_products(session: Annotated[AsyncSession, Depends(get_session)], limit: int = 20):
    result = await session.execute(select(Product).order_by(Product.id).limit(limit))
    return result.scalars().all()


@app.post("/products", status_code=201)
async def create_product(data: ProductIn, session: Annotated[AsyncSession, Depends(get_session)]):
    product = Product(**data.model_dump())
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product
```

Rules of thumb:

- **Every** database round trip is awaited: `await session.execute(...)`, `await session.get(...)`, `await session.commit()`.
- `session.add()` is **not** awaited: it only stages the object.
- `expire_on_commit=False` keeps attributes readable after commit without another query.
- **Lazy loading doesn't work** in async (touching an unloaded relationship raises `MissingGreenlet`). Load relationships up front: `select(Order).options(selectinload(Order.items))`.
- Never share one `AsyncSession` between concurrent tasks; one session per request.

## Worked example: deciding def vs async def in Taskboard

Go through Taskboard's endpoints and ask: **does it call anything blocking?**

| Endpoint | Calls | Choose |
|---|---|---|
| `GET /tasks` | sync SQLModel `Session` (blocking driver) | `def` |
| `POST /tasks/{id}/attachments` | `await file.read()` | `async def` |
| `notify_chat()` | `httpx.AsyncClient.post` | `async def` |
| `/ws/board` | WebSocket send/receive | `async def` (required) |

Mixing is completely fine: FastAPI runs `def` endpoints in a thread pool and `async def` ones on the event loop. The bug is putting a **blocking** call inside `async def`.

## Worked example: broadcasting task events

```python title=realtime.py
class Board:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def join(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def leave(self, ws: WebSocket):
        self.clients.discard(ws)

    async def publish(self, event: dict):
        for ws in list(self.clients):
            try:
                await ws.send_json(event)
            except Exception:
                self.leave(ws)                 # a dead connection shouldn't break the others

board = Board()

@router.websocket("/ws/board")
async def board_socket(ws: WebSocket):
    await board.join(ws)
    try:
        while True:
            await ws.receive_text()            # keep the connection open; ignore client messages
    except WebSocketDisconnect:
        board.leave(ws)
```

Then, after a task changes, the endpoint publishes an event: `await board.publish({"type": "task.updated", "id": task.id, "status": task.status})`. Every connected browser gets it within milliseconds.

> [!plain] In plain English
> HTTP is "ask, then get one answer". A WebSocket is an open phone line: once connected, the server can push messages whenever something happens.

## Common mistakes

> [!mistake] Broadcasting from a sync endpoint
> You can't `await` inside a `def` endpoint. Make the endpoint `async def` (and keep its DB work non-blocking), or hand the event to a background task.

:::quiz
q: An `async def` route calls `requests.get(url)` (a blocking library). What's the effect under load?
- none; FastAPI runs it in a thread automatically
+ while it waits, the event loop is blocked and every other request on that worker stalls
- the request fails with a RuntimeError
- requests becomes async automatically
why: Only `def` routes run in the thread pool. Blocking calls in `async def` freeze the loop. Use httpx.AsyncClient or make the route `def`.
:::

:::quiz
q: Three independent upstream calls take 100 ms each. Roughly how long does `await asyncio.gather(a(), b(), c())` take?
- 300 ms
+ about 100 ms
- 33 ms
- it depends on the thread pool size
why: gather runs the awaits concurrently, so the total is about the slowest one.
:::

:::quiz
q: What must a WebSocket endpoint do before it can receive messages?
+ `await websocket.accept()`
- return a 101 response
- call `websocket.open()`
- declare `response_model`
why: accept() completes the upgrade handshake.
:::

:::quiz
q: With `AsyncSession`, which call is **not** awaited?
- `session.execute(stmt)`
- `session.commit()`
+ `session.add(obj)`
- `session.refresh(obj)`
why: add() only stages the object in memory. Database round trips are awaited.
:::

:::exercise
id: fa-fix-blocking
level: 2
title: Unblock the event loop
mode: code
lang: python
file: main.py
---
This `async def` route freezes the server for half a second per request. Replace the blocking sleep with the non-blocking equivalent.
---starter
import asyncio
import time

from fastapi import FastAPI

app = FastAPI()


@app.get("/slow")
async def slow():
    time.sleep(0.5)
    return {"done": True}
---rule
await\s+asyncio\.sleep\(\s*0?\.5\s*\)
`await asyncio.sleep(0.5)`
---rule
!time\.sleep\(
No `time.sleep`
---rule
async\s+def\s+slow\(
Keep it `async def`
---solution
import asyncio
import time

from fastapi import FastAPI

app = FastAPI()


@app.get("/slow")
async def slow():
    await asyncio.sleep(0.5)
    return {"done": True}
:::

:::exercise
id: fa-to-thread
level: 3
title: Offload a blocking SDK call
mode: code
lang: python
file: main.py
---
`legacy_sdk.fetch_report(report_id)` is a **blocking** function and the route must stay `async def`. Call it with `await asyncio.to_thread(...)` (or `run_in_threadpool`) and return its result.
---starter
import asyncio

from fastapi import FastAPI

import legacy_sdk

app = FastAPI()


@app.get("/reports/{report_id}")
async def get_report(report_id: int):
    return legacy_sdk.fetch_report(report_id)
---rule
await\s+(asyncio\.to_thread|run_in_threadpool)\(\s*legacy_sdk\.fetch_report\s*,\s*report_id\s*\)
`await asyncio.to_thread(legacy_sdk.fetch_report, report_id)`
---rule
!return\s+legacy_sdk\.fetch_report\(
Don't call it directly on the loop
---rule
async\s+def\s+get_report\(
Keep it `async def`
---solution
import asyncio

from fastapi import FastAPI

import legacy_sdk

app = FastAPI()


@app.get("/reports/{report_id}")
async def get_report(report_id: int):
    return await asyncio.to_thread(legacy_sdk.fetch_report, report_id)
:::

:::exercise
id: fa-gather
level: 3
title: Fan out with gather
mode: code
lang: python
file: main.py
---
Complete `GET /summary/{user_id}`: using the shared `client` (an `httpx.AsyncClient`), fetch `f"{USERS}/{user_id}"` and `f"{ORDERS}?user={user_id}"` **concurrently** with `asyncio.gather`, and return `{"user": <first json>, "orders": <second json>}`.
---starter
import asyncio

import httpx
from fastapi import FastAPI

app = FastAPI()
client = httpx.AsyncClient(timeout=5)
USERS = "http://users.internal/users"
ORDERS = "http://orders.internal/orders"


@app.get("/summary/{user_id}")
async def summary(user_id: int):
    ...
---rule
await\s+asyncio\.gather\(
`await asyncio.gather(...)`
---rule
client\.get\(\s*f["']\{USERS\}/\{user_id\}["']\s*\)
Fetch the user
---rule
client\.get\(\s*f["']\{ORDERS\}\?user=\{user_id\}["']\s*\)
Fetch the orders
---rule
["']user["']\s*:\s*\w+\.json\(\s*\)
Return the user JSON
---rule
["']orders["']\s*:\s*\w+\.json\(\s*\)
Return the orders JSON
---solution
import asyncio

import httpx
from fastapi import FastAPI

app = FastAPI()
client = httpx.AsyncClient(timeout=5)
USERS = "http://users.internal/users"
ORDERS = "http://orders.internal/orders"


@app.get("/summary/{user_id}")
async def summary(user_id: int):
    user, orders = await asyncio.gather(
        client.get(f"{USERS}/{user_id}"),
        client.get(f"{ORDERS}?user={user_id}"),
    )
    return {"user": user.json(), "orders": orders.json()}
:::

:::exercise
id: fa-ws-echo
level: 2
title: An uppercase echo socket
mode: code
lang: python
file: main.py
---
Write a WebSocket endpoint at `/ws/shout` that accepts the connection, then loops forever receiving text and sending it back **uppercased**. Stop quietly on `WebSocketDisconnect`.
---starter
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()
---rule
@app\.websocket\(\s*["']/ws/shout["']\s*\)
`@app.websocket("/ws/shout")`
---rule
async\s+def\s+\w+\(\s*(websocket|ws)\s*:\s*WebSocket\s*\)
`async def ...(websocket: WebSocket)`
---rule
await\s+(websocket|ws)\.accept\(\s*\)
Accept first
---rule
while\s+True\s*:
Loop
---rule
=\s*await\s+(websocket|ws)\.receive_text\(\s*\)
`await websocket.receive_text()`
---rule
await\s+(websocket|ws)\.send_text\(\s*\w+\.upper\(\s*\)\s*\)
Send it back uppercased
---rule
except\s+WebSocketDisconnect
Handle `WebSocketDisconnect`
---solution
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()


@app.websocket("/ws/shout")
async def shout(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            text = await websocket.receive_text()
            await websocket.send_text(text.upper())
    except WebSocketDisconnect:
        pass
:::

:::exercise
id: fa-ws-broadcast
level: 3
title: Finish the connection manager
mode: code
lang: python
file: chat.py
---
Implement the three methods: `connect` accepts the socket and appends it to `self.active`; `disconnect` removes it; `broadcast` sends `message` with `send_text` to every active socket.
---starter
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        ...

    def disconnect(self, ws: WebSocket):
        ...

    async def broadcast(self, message: str):
        ...
---rule
async\s+def\s+connect\(self,\s*ws[^)]*\):\s*\n\s+await\s+ws\.accept\(\s*\)
`connect` awaits `ws.accept()`
---rule
self\.active\.append\(\s*ws\s*\)
Track the socket
---rule
self\.active\.remove\(\s*ws\s*\)
`disconnect` removes it
---rule
for\s+(\w+)\s+in\s+self\.active\s*:\s*\n\s+await\s+\1\.send_text\(\s*message\s*\)
`broadcast` sends to each socket
---solution
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, message: str):
        for conn in self.active:
            await conn.send_text(message)
:::

:::exercise
id: fa-async-session
level: 3
title: Async session dependency
mode: code
lang: python
file: db.py
---
Create `engine = create_async_engine(DATABASE_URL)`, `SessionLocal = async_sessionmaker(engine, expire_on_commit=False)`, and an async generator dependency `get_session()` that does `async with SessionLocal() as session:` and yields the session.
---starter
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DATABASE_URL = "postgresql+asyncpg://app:secret@db/app"
---rule
engine\s*=\s*create_async_engine\(\s*DATABASE_URL
`create_async_engine(DATABASE_URL)`
---rule
SessionLocal\s*=\s*async_sessionmaker\(\s*engine\s*,\s*expire_on_commit\s*=\s*False\s*\)
`async_sessionmaker(engine, expire_on_commit=False)`
---rule
async\s+def\s+get_session\(\s*\)
`async def get_session()`
---rule
async\s+with\s+SessionLocal\(\s*\)\s+as\s+session\s*:\s*\n\s+yield\s+session
`async with SessionLocal() as session: yield session`
---solution
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DATABASE_URL = "postgresql+asyncpg://app:secret@db/app"

engine = create_async_engine(DATABASE_URL)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session():
    async with SessionLocal() as session:
        yield session
:::

:::exercise
id: fa-async-create
level: 3
title: Async create
mode: code
lang: python
file: routes.py
---
Finish `create_tag`: build `Tag(name=data.name)`, add it to the session, **await** the commit and refresh, and return it.
---starter
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from models import Tag, TagIn

router = APIRouter()


@router.post("/tags", status_code=201)
async def create_tag(data: TagIn, session: Annotated[AsyncSession, Depends(get_session)]):
    ...
---rule
tag\s*=\s*Tag\(\s*name\s*=\s*data\.name\s*\)
`tag = Tag(name=data.name)`
---rule
^\s+session\.add\(\s*tag\s*\)
`session.add(tag)` (not awaited)
---rule
await\s+session\.commit\(\s*\)
`await session.commit()`
---rule
await\s+session\.refresh\(\s*tag\s*\)
`await session.refresh(tag)`
---rule
return\s+tag
Return it
---solution
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from models import Tag, TagIn

router = APIRouter()


@router.post("/tags", status_code=201)
async def create_tag(data: TagIn, session: Annotated[AsyncSession, Depends(get_session)]):
    tag = Tag(name=data.name)
    session.add(tag)
    await session.commit()
    await session.refresh(tag)
    return tag
:::

:::exercise
id: fa-which-def
level: 2
title: def or async def?
mode: answer
---
A route uses `psycopg2` (a blocking driver) and the sync `requests` library, and you can't change either. Should the route be `def` or `async def`?
---answer
def
---solution
def
---explain
Plain `def` routes run in the thread pool, so their blocking calls don't stall the event loop.
:::

:::exercise
id: proj-fa-12-board
level: 3
title: "Project 12: the board broadcaster"
mode: code
lang: python
file: realtime.py
---
Implement `Board`: `join` accepts the socket and adds it to `self.clients` (a set); `leave` removes it with `discard`; `publish(event)` sends `event` with `send_json` to every client in `list(self.clients)`.
---starter
from fastapi import WebSocket


class Board:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def join(self, ws: WebSocket):
        ...

    def leave(self, ws: WebSocket):
        ...

    async def publish(self, event: dict):
        ...
---rule
async\s+def\s+join\(self,\s*ws[^)]*\):\s*\n\s+await\s+ws\.accept\(\s*\)
`join` accepts first
---rule
self\.clients\.add\(\s*ws\s*\)
Add to the set
---rule
self\.clients\.discard\(\s*ws\s*\)
`leave` uses `discard`
---rule
for\s+(\w+)\s+in\s+list\(\s*self\.clients\s*\)\s*:[\s\S]*?await\s+\1\.send_json\(\s*event\s*\)
`publish` sends JSON to each client
---solution
from fastapi import WebSocket


class Board:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def join(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def leave(self, ws: WebSocket):
        self.clients.discard(ws)

    async def publish(self, event: dict):
        for ws in list(self.clients):
            await ws.send_json(event)
:::

:::exercise
id: proj-fa-12-notify
level: 3
title: "Project 12b: notify the chat channel"
mode: code
lang: python
file: notify.py
---
Write `async def notify_chat(client: httpx.AsyncClient, task_title: str)` that POSTs JSON `{"text": f"Task done: {task_title}"}` to `WEBHOOK_URL` with `await client.post(...)`, and calls `raise_for_status()` on the response.
---starter
import httpx

WEBHOOK_URL = "https://chat.example.com/hooks/taskboard"
---rule
async\s+def\s+notify_chat\(\s*client\s*:\s*httpx\.AsyncClient\s*,\s*task_title\s*:\s*str\s*\)
The async function signature
---rule
await\s+client\.post\(\s*WEBHOOK_URL\s*,\s*json\s*=\s*\{\s*["']text["']\s*:\s*f["']Task done: \{task_title\}["']\s*\}\s*\)
`await client.post(WEBHOOK_URL, json={...})`
---rule
\.raise_for_status\(\s*\)
`raise_for_status()`
---rule
!requests\.
No blocking `requests`
---solution
import httpx

WEBHOOK_URL = "https://chat.example.com/hooks/taskboard"


async def notify_chat(client: httpx.AsyncClient, task_title: str):
    response = await client.post(WEBHOOK_URL, json={"text": f"Task done: {task_title}"})
    response.raise_for_status()
:::
