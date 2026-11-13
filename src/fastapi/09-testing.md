---
id: fastapi-testing
title: Testing, middleware & settings
summary: Testing endpoints with TestClient and pytest, overriding dependencies in tests, middleware and CORS, background tasks, and typed configuration from environment variables.
minutes: 35
---
> [!project] Taskboard, step 9: a test suite
> Taskboard now has enough behaviour to break. This step adds `tests/test_tasks.py`: tests that run against a throwaway in-memory database, with the current user overridden, so they're fast and repeatable. The CI/CD track runs exactly these tests on every push.

## TestClient

`TestClient` calls your app in-process (no server needed) with a `requests`-style API. Tests are plain `pytest` functions:

```python title=tests/test_main.py
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_and_read_note():
    created = client.post("/notes", json={"text": "buy milk"})
    assert created.status_code == 201
    note_id = created.json()["id"]

    fetched = client.get(f"/notes/{note_id}")
    assert fetched.json()["text"] == "buy milk"


def test_missing_note_is_404():
    assert client.get("/notes/9999").status_code == 404


def test_validation_error():
    response = client.post("/notes", json={})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "text"]
```

Run with `pytest` (add `-q` for quiet, `-k name` to pick tests). Test the **contract**: status codes, JSON shape, error cases, not just the happy path.

| Request helper | Example |
|---|---|
| query string | `client.get("/items", params={"q": "bolt"})` |
| JSON body | `client.post("/items", json={...})` |
| headers | `client.get("/me", headers={"Authorization": "Bearer abc"})` |
| response | `.status_code`, `.json()`, `.text`, `.headers` |

## Overriding dependencies

Swap real dependencies (database, current user, external APIs) for fakes in tests:

```python
from main import app, get_current_user

def fake_user():
    return {"name": "test", "role": "admin"}

app.dependency_overrides[get_current_user] = fake_user
# ... tests ...
app.dependency_overrides.clear()
```

For databases, override `get_session` with a session bound to a test database (often SQLite in memory) so tests don't touch real data.

## Middleware

Middleware wraps every request and response: timing, logging, request IDs, headers.

```python
import time
from fastapi import Request

@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)          # run the route
    response.headers["X-Process-Time"] = f"{time.perf_counter() - start:.4f}"
    return response
```

## CORS

Browsers block a page on `https://app.example.com` from calling an API on another origin unless the API allows it via **CORS** headers:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
```

Don't combine `allow_origins=["*"]` with credentials; list the real front-end origins. CORS is a browser rule: curl and server-to-server calls ignore it.

## Background tasks

Work that the client doesn't need to wait for (sending an email, writing an audit log) can run after the response:

```python
from fastapi import BackgroundTasks

def send_welcome_email(address: str): ...

@app.post("/signup", status_code=201)
def signup(user: UserCreate, tasks: BackgroundTasks):
    save(user)
    tasks.add_task(send_welcome_email, user.email)
    return {"ok": True}
```

For heavy or must-not-lose jobs, use a real queue (Celery, RQ, arq) instead.

## Settings from the environment

`pydantic-settings` reads typed configuration from environment variables (and optionally a `.env` file):

```python title=config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    debug: bool = False
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()      # reads DATABASE_URL, SECRET_KEY, DEBUG
```

Missing required settings fail fast at startup with a clear validation error, which beats a crash on the first request.

## Worked example: a test fixture that swaps the database

```python title=tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from main import app
from db import get_session
from deps import get_current_user


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)

    def session_override():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_current_user] = lambda: {"name": "ada"}
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
```

- `sqlite://` (no file name) is an **in-memory** database: created for each test, gone afterwards. `StaticPool` keeps the same connection so every session sees the same in-memory data.
- `dependency_overrides` replaces the real dependencies **only in tests**: no real database, no real auth.
- The `yield` makes it a fixture with teardown: the overrides are cleared after each test.

```python title=tests/test_tasks.py
def test_create_then_get(client):
    created = client.post("/tasks", json={"title": "Write docs", "priority": 2})
    assert created.status_code == 201
    task_id = created.json()["id"]

    got = client.get(f"/tasks/{task_id}")
    assert got.status_code == 200
    assert got.json()["title"] == "Write docs"
    assert got.json()["owner"] == "ada"


def test_missing_task_is_404(client):
    assert client.get("/tasks/999").status_code == 404


def test_priority_out_of_range_is_422(client):
    assert client.post("/tasks", json={"title": "x", "priority": 9}).status_code == 422
```

> [!plain] In plain English
> A test calls your code with known input and **asserts** the output is what you expect. pytest finds every function named `test_*` in files named `test_*.py` and runs it; a fixture is setup code that tests ask for by naming it as a parameter.

## What to test

For each endpoint, test the **happy path** and each **failure you designed**: 404, 409, 422, 401, 403. Those error paths are exactly the ones that break silently during refactors. Arrange-act-assert keeps each test readable: set up data, make one request, check the result.

## Common mistakes

> [!mistake] Tests that depend on each other
> If `test_get` only passes because `test_create` ran first, the suite breaks when run in another order or in parallel. Each test creates its own data (the per-test in-memory DB makes this automatic).

:::quiz
q: What does `TestClient(app)` need running?
+ nothing; it calls the app in-process
- uvicorn on port 8000
- Docker
- a browser
why: TestClient drives the ASGI app directly.
:::

:::quiz
q: How do you replace `get_current_user` with a fake in tests?
- monkeypatch the route function
+ `app.dependency_overrides[get_current_user] = fake_user`
- set an environment variable
- edit the decorator
why: dependency_overrides maps a dependency to a replacement for the app.
:::

:::quiz
q: A React app on localhost:5173 can't call your API on localhost:8000, but curl works. What's missing?
- an API key
+ CORS configuration allowing the http://localhost:5173 origin
- HTTPS
- a background task
why: Different port = different origin. Browsers enforce CORS; curl doesn't.
:::

:::quiz
q: With pydantic-settings, `database_url: str` is read from which environment variable by default?
- database_url only
+ DATABASE_URL (matching is case-insensitive)
- DB_URL
- SETTINGS_DATABASE_URL
why: Field names map to environment variable names, case-insensitively by default.
:::

:::exercise
id: ft-test-health
level: 1
title: Your first test
mode: code
lang: python
file: tests/test_health.py
---
Write `test_health()` that calls `GET /health` with `client` and asserts the status is **200** and the JSON is `{"status": "ok"}`.
---starter
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
---rule
def\s+test_health\(\s*\)\s*:
`def test_health():`
---rule
client\.get\(\s*["']/health["']\s*\)
`client.get("/health")`
---rule
assert\s+\w+\.status_code\s*==\s*200
assert the status is 200
---rule
assert\s+\w+\.json\(\)\s*==\s*\{\s*["']status["']\s*:\s*["']ok["']\s*\}
assert the JSON body
---solution
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
:::

:::exercise
id: ft-test-422
level: 2
title: Test the unhappy path
mode: code
lang: python
file: tests/test_items.py
---
Write `test_rejects_bad_price()` that POSTs `{"name": "Bolt", "price": "cheap"}` to `/items` (as `json=`) and asserts a **422** whose first error's `loc` is `["body", "price"]`.
---starter
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
---rule
def\s+test_rejects_bad_price\(\s*\)\s*:
`def test_rejects_bad_price():`
---rule
client\.post\(\s*["']/items["']\s*,\s*json\s*=\s*\{(?=[^}]*["']name["']\s*:\s*["']Bolt["'])(?=[^}]*["']price["']\s*:\s*["']cheap["'])
POST the bad body with `json=`
---rule
assert\s+\w+\.status_code\s*==\s*422
assert 422
---rule
\.json\(\)\[\s*["']detail["']\s*\]\[\s*0\s*\]\[\s*["']loc["']\s*\]\s*==\s*\[\s*["']body["']\s*,\s*["']price["']\s*\]
assert `response.json()["detail"][0]["loc"] == ["body", "price"]`
---solution
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_rejects_bad_price():
    response = client.post("/items", json={"name": "Bolt", "price": "cheap"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "price"]
:::

:::exercise
id: ft-override
level: 3
title: Fake the current user
mode: code
lang: python
file: tests/test_admin.py
---
Override `get_current_user` with a function `fake_admin()` returning `{"name": "t", "role": "admin"}`, call `GET /admin/stats`, assert **200**, then clear the overrides.
---starter
from fastapi.testclient import TestClient

from main import app, get_current_user

client = TestClient(app)
---rule
def\s+fake_admin\(\s*\)\s*:[\s\S]*?return\s*\{(?=[^}]*["']role["']\s*:\s*["']admin["'])
`fake_admin()` returns a user with role admin
---rule
app\.dependency_overrides\[\s*get_current_user\s*\]\s*=\s*fake_admin
`app.dependency_overrides[get_current_user] = fake_admin`
---rule
client\.get\(\s*["']/admin/stats["']\s*\)
`client.get("/admin/stats")`
---rule
assert\s+\w+\.status_code\s*==\s*200
assert 200
---rule
app\.dependency_overrides\.clear\(\s*\)
`app.dependency_overrides.clear()`
---solution
from fastapi.testclient import TestClient

from main import app, get_current_user

client = TestClient(app)


def fake_admin():
    return {"name": "t", "role": "admin"}


def test_admin_stats():
    app.dependency_overrides[get_current_user] = fake_admin
    response = client.get("/admin/stats")
    assert response.status_code == 200
    app.dependency_overrides.clear()
:::

:::exercise
id: ft-cors
level: 2
title: Allow the front-end
mode: code
lang: python
file: main.py
---
Add `CORSMiddleware` allowing the origin `http://localhost:5173` with all methods and headers.
---starter
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
---rule
app\.add_middleware\(\s*CORSMiddleware
`app.add_middleware(CORSMiddleware, ...)`
---rule
allow_origins\s*=\s*\[\s*["']http://localhost:5173["']\s*\]
`allow_origins=["http://localhost:5173"]`
---rule
allow_methods\s*=\s*\[\s*["']\*["']\s*\]
`allow_methods=["*"]`
---rule
allow_headers\s*=\s*\[\s*["']\*["']\s*\]
`allow_headers=["*"]`
---solution
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
:::

:::exercise
id: ft-middleware
level: 3
title: A request-ID header
mode: code
lang: python
file: main.py
---
Write an `http` middleware `add_request_id` that awaits `call_next(request)` and sets the response header `X-Request-ID` to `str(uuid.uuid4())` before returning the response.
---starter
import uuid

from fastapi import FastAPI, Request

app = FastAPI()
---rule
@app\.middleware\(\s*["']http["']\s*\)
`@app.middleware("http")`
---rule
async\s+def\s+add_request_id\(\s*request\s*:\s*Request\s*,\s*call_next\s*\)
`async def add_request_id(request: Request, call_next)`
---rule
=\s*await\s+call_next\(\s*request\s*\)
`response = await call_next(request)`
---rule
\.headers\[\s*["']X-Request-ID["']\s*\]\s*=\s*str\(\s*uuid\.uuid4\(\)\s*\)
Set `X-Request-ID`
---rule
return\s+response
Return the response
---solution
import uuid

from fastapi import FastAPI, Request

app = FastAPI()


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Request-ID"] = str(uuid.uuid4())
    return response
:::

:::exercise
id: ft-background
level: 2
title: Don't make the client wait
mode: code
lang: python
file: main.py
---
In `POST /orders`, accept `tasks: BackgroundTasks` and schedule `send_receipt(order.email)` with `tasks.add_task`, then return `{"status": "received"}` with status 202.
---starter
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

app = FastAPI()


class Order(BaseModel):
    email: str


def send_receipt(address: str):
    ...
---rule
@app\.post\(\s*["']/orders["'][^)]*status_code\s*=\s*(202|status\.HTTP_202_ACCEPTED)
`@app.post("/orders", status_code=202)`
---rule
tasks\s*:\s*BackgroundTasks
`tasks: BackgroundTasks` parameter
---rule
tasks\.add_task\(\s*send_receipt\s*,\s*order\.email\s*\)
`tasks.add_task(send_receipt, order.email)`
---rule
!send_receipt\(\s*order\.email\s*\)
Don't call `send_receipt` directly
---rule
return\s*\{\s*["']status["']\s*:\s*["']received["']\s*\}
Return `{"status": "received"}`
---solution
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

app = FastAPI()


class Order(BaseModel):
    email: str


def send_receipt(address: str):
    ...


@app.post("/orders", status_code=202)
def create_order(order: Order, tasks: BackgroundTasks):
    tasks.add_task(send_receipt, order.email)
    return {"status": "received"}
:::

:::exercise
id: ft-settings
level: 3
title: Typed settings
mode: code
lang: python
file: config.py
---
Write a `Settings(BaseSettings)` class with required `database_url: str` and `secret_key: str`, plus `debug: bool = False`, loading a `.env` file via `model_config = SettingsConfigDict(env_file=".env")`. Then create `settings = Settings()`.
---starter
from pydantic_settings import BaseSettings, SettingsConfigDict
---rule
class\s+Settings\s*\(\s*BaseSettings\s*\)
`class Settings(BaseSettings):`
---rule
database_url\s*:\s*str\s*$
`database_url: str` (required)
---rule
secret_key\s*:\s*str\s*$
`secret_key: str` (required)
---rule
debug\s*:\s*bool\s*=\s*False
`debug: bool = False`
---rule
model_config\s*=\s*SettingsConfigDict\(\s*env_file\s*=\s*["']\.env["']\s*\)
`model_config = SettingsConfigDict(env_file=".env")`
---rule
^settings\s*=\s*Settings\(\s*\)
`settings = Settings()`
---solution
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    debug: bool = False
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
:::

:::exercise
id: ft-predict-test
level: 2
title: Predict: does it pass?
mode: answer
---
```python
@app.post("/items", status_code=201)
def create(item: Item):
    return item

def test_create():
    r = client.post("/items", json={"name": "Bolt", "price": 1.5})
    assert r.status_code == 200
```

Does `test_create` pass or fail?
---answer
fail
---answer
fails
---solution
fail
---explain
The route returns 201, so `assert r.status_code == 200` fails.
:::

:::exercise
id: proj-fa-09-test-create
level: 2
title: "Project 9: test task creation"
mode: code
lang: python
file: tests/test_tasks.py
---
Write `test_create_task(client)`: POST `/tasks` with JSON `{"title": "Write docs", "priority": 2}`, assert the status code is **201**, and assert the response JSON's `status` is `"todo"` and its `owner` is `"ada"`.
---starter
def test_health(client):
    assert client.get("/health").status_code == 200
---rule
def\s+test_create_task\(\s*client\s*\)\s*:
`def test_create_task(client):`
---rule
client\.post\(\s*["']/tasks["']\s*,\s*json\s*=\s*\{\s*["']title["']\s*:\s*["']Write docs["']\s*,\s*["']priority["']\s*:\s*2\s*\}\s*\)
POST the task
---rule
assert\s+\w+\.status_code\s*==\s*201
Assert 201
---rule
assert\s+\w+\.json\(\s*\)\[\s*["']status["']\s*\]\s*==\s*["']todo["']|assert\s+\w+\[\s*["']status["']\s*\]\s*==\s*["']todo["']
Assert status `todo`
---rule
assert\s+\w+\.json\(\s*\)\[\s*["']owner["']\s*\]\s*==\s*["']ada["']|assert\s+\w+\[\s*["']owner["']\s*\]\s*==\s*["']ada["']
Assert owner `ada`
---solution
def test_health(client):
    assert client.get("/health").status_code == 200


def test_create_task(client):
    response = client.post("/tasks", json={"title": "Write docs", "priority": 2})
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "todo"
    assert body["owner"] == "ada"
:::

:::exercise
id: proj-fa-09-test-errors
level: 2
title: "Project 9b: test the failures"
mode: code
lang: python
file: tests/test_tasks.py
---
Write two tests: `test_missing_task_is_404(client)` asserting that `GET /tasks/999` returns **404**, and `test_bad_priority_is_422(client)` asserting that POSTing `{"title": "x", "priority": 9}` to `/tasks` returns **422**.
---starter
---rule
def\s+test_missing_task_is_404\(\s*client\s*\)\s*:
`test_missing_task_is_404`
---rule
client\.get\(\s*["']/tasks/999["']\s*\)\.status_code\s*==\s*404|client\.get\(\s*["']/tasks/999["']\s*\)[\s\S]*?status_code\s*==\s*404
`GET /tasks/999` → 404
---rule
def\s+test_bad_priority_is_422\(\s*client\s*\)\s*:
`test_bad_priority_is_422`
---rule
client\.post\(\s*["']/tasks["']\s*,\s*json\s*=\s*\{\s*["']title["']\s*:\s*["']x["']\s*,\s*["']priority["']\s*:\s*9\s*\}\s*\)[\s\S]*?status_code\s*==\s*422
Priority 9 → 422
---solution
def test_missing_task_is_404(client):
    assert client.get("/tasks/999").status_code == 404


def test_bad_priority_is_422(client):
    response = client.post("/tasks", json={"title": "x", "priority": 9})
    assert response.status_code == 422
:::

:::exercise
id: proj-fa-09-override
level: 3
title: "Project 9c: fake the current user"
mode: code
lang: python
file: tests/conftest.py
---
In the `client` fixture, override `get_current_user` so it returns `{"name": "ada"}`, create the `TestClient` with a `with` block and `yield` it, and clear the overrides afterwards.
---starter
import pytest
from fastapi.testclient import TestClient

from deps import get_current_user
from main import app


@pytest.fixture
def client():
    ...
---rule
app\.dependency_overrides\[\s*get_current_user\s*\]\s*=\s*lambda\s*:\s*\{\s*["']name["']\s*:\s*["']ada["']\s*\}
Override `get_current_user`
---rule
with\s+TestClient\(\s*app\s*\)\s+as\s+(\w+)\s*:\s*\n\s+yield\s+\1
`with TestClient(app) as c: yield c`
---rule
app\.dependency_overrides\.clear\(\s*\)
Clear the overrides
---rule
yield[\s\S]*dependency_overrides\.clear
Clear after the test
---solution
import pytest
from fastapi.testclient import TestClient

from deps import get_current_user
from main import app


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: {"name": "ada"}
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
:::
