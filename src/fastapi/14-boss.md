---
id: fastapi-boss
title: Boss round: build & debug
summary: Larger exercises that combine models, validation, errors, dependencies and status codes, plus predict-the-response puzzles that test how FastAPI really behaves.
minutes: 50
---
> [!project] Taskboard, final step: the assembled service
> The boss round finishes Taskboard: the final `main.py` that wires every piece together, plus a status-transition rule that ties validation, errors and the database together.

## How to approach an API task

1. **Design the contract first.** For each endpoint: method, path, path/query parameters, request model, response model, success status, error statuses.
2. **Write the models.** Input, update and output schemas. Put constraints in `Field`.
3. **Write the handlers thin.** Validation is already done by FastAPI; look things up, raise `HTTPException` for 404/409/403, return data.
4. **Pull cross-cutting logic into dependencies.** Auth, pagination, sessions.
5. **Test the unhappy paths.** 404, 409, 422, 401/403.

A worked contract:

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| `POST /accounts` | `AccountCreate {owner, initial: float ≥ 0}` | 201 `AccountOut` | 422 |
| `GET /accounts/{id}` | — | 200 `AccountOut` | 404 |
| `POST /accounts/{id}/deposit` | `Amount {value: float > 0}` | 200 `AccountOut` | 404, 422 |
| `POST /accounts/{id}/withdraw` | `Amount` | 200 `AccountOut` | 404, 409 insufficient funds, 422 |

## Worked example: Taskboard's final layout

```
taskboard/
├── main.py              app, lifespan, middleware, routers
├── config.py            Settings (env vars)
├── db.py                engine, Task/User tables, SessionDep
├── security.py          password hashing, JWT create/verify
├── deps.py              CurrentUser, Paging
├── models.py            TaskCreate, TaskUpdate, TaskOut
├── realtime.py          Board (WebSocket broadcaster)
├── routers/
│   ├── auth.py          POST /token
│   ├── tasks.py         CRUD + attachments
│   └── export.py        GET /tasks.csv
└── tests/
    ├── conftest.py
    └── test_tasks.py
```

Each file answers one question. "Where are passwords checked?" `security.py`. "What can a client send?" `models.py`. When a codebase is organized like this, new teammates find things without asking.

## Worked example: a state machine for status

Tasks shouldn't jump anywhere. Allowed moves:

```
todo ──► doing ──► done
  ▲        │
  └────────┘        (done is final)
```

Encode it as data, not a pile of `if`s:

```python
ALLOWED = {"todo": {"doing"}, "doing": {"todo", "done"}, "done": set()}

def change_status(task: Task, new: str) -> None:
    if new not in ALLOWED[task.status]:
        raise InvalidTransition(task.status, new)        # handler → 409
    task.status = new
```

Adding a `review` state later means editing one dictionary.

:::exercise
id: fb-bank
level: 4
title: A tiny bank
mode: code
lang: python
file: main.py
---
Implement the withdraw endpoint from the contract above. Define `Amount(BaseModel)` with `value: float = Field(gt=0)`. `POST /accounts/{account_id}/withdraw` must raise **404** `"Account not found"` for unknown accounts, raise **409** `"Insufficient funds"` if `value` exceeds the balance, otherwise subtract it and return the account dict.
---starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()

accounts = {1: {"id": 1, "owner": "ada", "balance": 100.0}}
---rule
class\s+Amount\s*\(\s*BaseModel\s*\)\s*:\s*\n\s+value\s*:\s*float\s*=\s*Field\([^)]*gt\s*=\s*0
`Amount` with `value: float = Field(gt=0)`
---rule
@app\.post\(\s*["']/accounts/\{account_id\}/withdraw["']
`POST /accounts/{account_id}/withdraw`
---rule
def\s+\w+\(\s*account_id\s*:\s*int\s*,\s*\w+\s*:\s*Amount\s*\)
Takes `account_id: int` and an `Amount` body
---rule
raise\s+HTTPException\([^)]*404[^)]*["']Account not found["']
404 for unknown accounts
---rule
if\s+\w+\.value\s*>\s*\w+\[\s*["']balance["']\s*\]\s*:|if\s+\w+\[\s*["']balance["']\s*\]\s*<\s*\w+\.value\s*:
Compare the amount with the balance
---rule
raise\s+HTTPException\([^)]*409[^)]*["']Insufficient funds["']
409 `"Insufficient funds"`
---rule
\[\s*["']balance["']\s*\]\s*-=\s*\w+\.value
Subtract from the balance
---solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()

accounts = {1: {"id": 1, "owner": "ada", "balance": 100.0}}


class Amount(BaseModel):
    value: float = Field(gt=0)


@app.post("/accounts/{account_id}/withdraw")
def withdraw(account_id: int, amount: Amount):
    account = accounts.get(account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if amount.value > account["balance"]:
        raise HTTPException(status_code=409, detail="Insufficient funds")
    account["balance"] -= amount.value
    return account
:::

:::exercise
id: fb-library
level: 4
title: Library checkout
mode: code
lang: python
file: main.py
---
Build `POST /books/{book_id}/checkout` that requires the current user (dependency `get_current_user`, already written, returns a username). 404 `"Book not found"` if unknown; 409 `"Already checked out"` if `book["borrower"]` is not `None`; otherwise set `book["borrower"]` to the user and return the book.
---starter
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()

books = {1: {"id": 1, "title": "Dune", "borrower": None}}


def get_current_user() -> str:
    return "ada"
---rule
@app\.post\(\s*["']/books/\{book_id\}/checkout["']
`POST /books/{book_id}/checkout`
---rule
\w+\s*:\s*Annotated\[\s*str\s*,\s*Depends\(\s*get_current_user\s*\)\s*\]
Uses `Annotated[str, Depends(get_current_user)]`
---rule
raise\s+HTTPException\([^)]*404[^)]*["']Book not found["']
404 for unknown books
---rule
\[\s*["']borrower["']\s*\]\s+is\s+not\s+None
Check `book["borrower"] is not None`
---rule
raise\s+HTTPException\([^)]*409[^)]*["']Already checked out["']
409 `"Already checked out"`
---rule
\[\s*["']borrower["']\s*\]\s*=\s*\w+
Record the borrower
---solution
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

app = FastAPI()

books = {1: {"id": 1, "title": "Dune", "borrower": None}}


def get_current_user() -> str:
    return "ada"


@app.post("/books/{book_id}/checkout")
def checkout(book_id: int, user: Annotated[str, Depends(get_current_user)]):
    book = books.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    if book["borrower"] is not None:
        raise HTTPException(status_code=409, detail="Already checked out")
    book["borrower"] = user
    return book
:::

:::exercise
id: fb-signup
level: 4
title: Signup with safe output
mode: code
lang: python
file: main.py
---
Implement `POST /signup` (201) taking `SignupIn` (`email: str`, `password: str = Field(min_length=8)`) and responding with `SignupOut` (`id: int`, `email: str`) as the `response_model`. Reject an email already in `users` with **409** `"Email already registered"`. Store `{"id": ..., "email": ..., "password_hash": hash_password(...)}` (never the raw password).
---starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
users: dict[str, dict] = {}


def hash_password(raw: str) -> str:
    return "hashed:" + raw[::-1]
---rule
class\s+SignupIn\s*\(\s*BaseModel\s*\)[\s\S]*?password\s*:\s*str\s*=\s*Field\([^)]*min_length\s*=\s*8
`SignupIn` with `password: str = Field(min_length=8)`
---rule
class\s+SignupOut\s*\(\s*BaseModel\s*\)\s*:(?:\s*\n\s+(?!password)\w+\s*:[^\n]*)+
`SignupOut` with `id` and `email` (no password)
---rule
@app\.post\(\s*["']/signup["'](?=[^)]*response_model\s*=\s*SignupOut)(?=[^)]*status_code\s*=\s*(201|status\.HTTP_201_CREATED))
`@app.post("/signup", response_model=SignupOut, status_code=201)`
---rule
if\s+\w+\.email\s+in\s+users\s*:
Check for an existing email
---rule
raise\s+HTTPException\([^)]*409[^)]*["']Email already registered["']
409 `"Email already registered"`
---rule
["']password_hash["']\s*:\s*hash_password\(\s*\w+\.password\s*\)
Store `password_hash` via `hash_password(...)`
---rule
!["']password["']\s*:\s*\w+\.password
Never store the raw password
---solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
users: dict[str, dict] = {}


def hash_password(raw: str) -> str:
    return "hashed:" + raw[::-1]


class SignupIn(BaseModel):
    email: str
    password: str = Field(min_length=8)


class SignupOut(BaseModel):
    id: int
    email: str


@app.post("/signup", response_model=SignupOut, status_code=201)
def signup(data: SignupIn):
    if data.email in users:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = {"id": len(users) + 1, "email": data.email, "password_hash": hash_password(data.password)}
    users[data.email] = user
    return user
:::

:::exercise
id: fb-predict-1
level: 3
title: Puzzle: body or query?
mode: answer
---
```python
@app.post("/score")
def score(points: int, player: Player):
    return {"player": player.name, "points": points}
```

`Player` is a Pydantic model with `name: str`. The client sends `POST /score` with body `{"name": "Ada", "points": 10}` and no query string. Status code?
---answer
422
---solution
422
---explain
`points` is a simple type, so it's a **query** parameter and it's required. The body's `"points"` key is ignored (it isn't a field of `Player`).
:::

:::exercise
id: fb-predict-2
level: 3
title: Puzzle: response_model and missing data
mode: answer
---
```python
class Out(BaseModel):
    id: int
    email: str

@app.get("/u", response_model=Out)
def u():
    return {"id": 1}
```

`GET /u` returns which status code?
---answer
500
---solution
500
---explain
The returned data fails validation against the response model (`email` is missing). That's a server bug, so FastAPI responds 500.
:::

:::exercise
id: fb-predict-3
level: 3
title: Puzzle: the default status
mode: answer
---
```python
@app.post("/things")
def create():
    return {"ok": True}
```

What status code does a successful `POST /things` return?
---answer
200
---solution
200
---explain
FastAPI's default is 200 for every method. You must set `status_code=201` yourself.
:::

:::exercise
id: fb-predict-4
level: 4
title: Puzzle: optional vs required
mode: answer
---
```python
@app.get("/a")
def a(x: int | None):
    return {"x": x}
```

What does `GET /a` (no query string) return? Give the status code.
---answer
422
---solution
422
---explain
`int | None` allows the **value** None but there's no default, so the parameter is still required. Add `= None` to make it optional.
:::

:::exercise
id: fb-predict-5
level: 4
title: Puzzle: lax booleans
mode: answer
---
```python
@app.get("/flag")
def flag(on: bool = False):
    return {"on": on}
```

What does `GET /flag?on=1` return?
---answer
{"on": true}
---solution
{"on": true}
:::

:::exercise
id: fb-predict-6
level: 3
title: Puzzle: exception handler
mode: answer
---
```python
class Nope(Exception): ...

@app.exception_handler(Nope)
async def h(request, exc):
    return JSONResponse(status_code=418, content={"detail": "teapot"})

@app.get("/brew")
def brew():
    raise Nope()
```

What status code does `GET /brew` return?
---answer
418
---solution
418
:::

:::exercise
id: proj-fa-14-transition
level: 4
title: "Project 15: status transitions"
mode: code
lang: python
file: rules.py
path: app/rules.py
---
Write `ALLOWED = {"todo": {"doing"}, "doing": {"todo", "done"}, "done": set()}`, `class InvalidTransition(Exception)`, and `change_status(task, new: str)` that raises `InvalidTransition()` when `new not in ALLOWED[task.status]` and otherwise sets `task.status = new`.
---starter
---rule
ALLOWED\s*=\s*\{\s*["']todo["']\s*:\s*\{\s*["']doing["']\s*\}\s*,\s*["']doing["']\s*:\s*\{\s*["'](todo|done)["']\s*,\s*["'](todo|done)["']\s*\}\s*,\s*["']done["']\s*:\s*set\(\s*\)\s*\}
The `ALLOWED` table
---rule
class\s+InvalidTransition\(\s*Exception\s*\)
`class InvalidTransition(Exception)`
---rule
def\s+change_status\(\s*task\s*,\s*new(\s*:\s*str)?\s*\)
`change_status(task, new)`
---rule
if\s+new\s+not\s+in\s+ALLOWED\[\s*task\.status\s*\]\s*:\s*\n\s+raise\s+InvalidTransition\(
Reject disallowed moves
---rule
task\.status\s*=\s*new
Apply allowed moves
---solution
ALLOWED = {"todo": {"doing"}, "doing": {"todo", "done"}, "done": set()}


class InvalidTransition(Exception):
    pass


def change_status(task, new: str) -> None:
    if new not in ALLOWED[task.status]:
        raise InvalidTransition()
    task.status = new
:::

:::exercise
id: proj-fa-14-main
level: 4
title: "Project 15b: the final main.py"
mode: code
lang: python
file: main.py
path: app/main.py
---
Assemble Taskboard: create `app = FastAPI(title="Taskboard", version="1.0.0", lifespan=lifespan)`; add the `add_request_id` middleware with `app.middleware("http")(add_request_id)`; add CORS with `allow_origins=settings.cors_origins`; include the `auth`, `tasks` and `export` routers; and register an exception handler for `InvalidTransition` returning **409** `{"detail": "Invalid status change"}`.
---starter
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from lifecycle import lifespan
from middleware import add_request_id
from routers import auth, export, tasks
from rules import InvalidTransition
---rule
app\s*=\s*FastAPI\((?=[^)]*title\s*=\s*["']Taskboard["'])(?=[^)]*version\s*=\s*["']1\.0\.0["'])(?=[^)]*lifespan\s*=\s*lifespan)
The app with lifespan
---rule
app\.middleware\(\s*["']http["']\s*\)\(\s*add_request_id\s*\)
Request-ID middleware
---rule
app\.add_middleware\(\s*CORSMiddleware\s*,[^)]*allow_origins\s*=\s*settings\.cors_origins
CORS from settings
---rule
app\.include_router\(\s*auth\.router\s*\)
Auth router
---rule
app\.include_router\(\s*tasks\.router\s*\)
Tasks router
---rule
app\.include_router\(\s*export\.router\s*\)
Export router
---rule
@app\.exception_handler\(\s*InvalidTransition\s*\)
Handler for `InvalidTransition`
---rule
JSONResponse\((?=[^)]*status_code\s*=\s*409)(?=[^)]*Invalid status change)
409 `"Invalid status change"`
---solution
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from lifecycle import lifespan
from middleware import add_request_id
from routers import auth, export, tasks
from rules import InvalidTransition

app = FastAPI(title="Taskboard", version="1.0.0", lifespan=lifespan)
app.middleware("http")(add_request_id)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])
app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(export.router)


@app.exception_handler(InvalidTransition)
async def invalid_transition_handler(request: Request, exc: InvalidTransition):
    return JSONResponse(status_code=409, content={"detail": "Invalid status change"})
:::
