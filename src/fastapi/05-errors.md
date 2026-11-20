---
id: fastapi-errors
title: Errors & status codes
summary: Raising HTTPException, choosing the right status code, the status module, custom exceptions with handlers, headers on errors, and what validation errors look like.
minutes: 25
---
> [!project] Taskboard, step 6: honest errors
> Taskboard currently answers `{"detail": "not found"}` with a **200**. This step fixes that with proper 404s, a 409 for duplicate titles, and a custom domain exception so the business logic doesn't need to know about HTTP.

## HTTPException

Return an error by **raising** `HTTPException`. FastAPI stops the handler and sends a JSON body `{"detail": ...}` with the status code you chose:

```python
from fastapi import FastAPI, HTTPException

items = {1: "Widget", 2: "Gadget"}

@app.get("/items/{item_id}")
def read_item(item_id: int):
    if item_id not in items:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"id": item_id, "name": items[item_id]}
```

`GET /items/9` → `404 {"detail": "Item not found"}`. `detail` can be any JSON-serializable value (a string, a dict, a list).

> [!warn] raise, not return
> `return HTTPException(...)` sends a **200** response containing a serialized exception object. It must be `raise`.

## Use the status module

`from fastapi import status` gives readable names, which are less error-prone than bare numbers:

```python
from fastapi import status

@app.post("/items", status_code=status.HTTP_201_CREATED)
...
raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Name already taken")
```

| Situation | Code | Constant |
|---|---|---|
| created | 201 | `HTTP_201_CREATED` |
| deleted, nothing to return | 204 | `HTTP_204_NO_CONTENT` |
| malformed request you detect yourself | 400 | `HTTP_400_BAD_REQUEST` |
| not logged in / bad token | 401 | `HTTP_401_UNAUTHORIZED` (add a `WWW-Authenticate` header) |
| logged in but not allowed | 403 | `HTTP_403_FORBIDDEN` |
| doesn't exist | 404 | `HTTP_404_NOT_FOUND` |
| duplicate / state conflict | 409 | `HTTP_409_CONFLICT` |
| input failed validation | 422 | (automatic) |

## Headers on errors

```python
raise HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid token",
    headers={"WWW-Authenticate": "Bearer"},
)
```

## Custom exceptions and handlers

Your business logic shouldn't know about HTTP. Raise domain exceptions and translate them once, centrally:

```python
from fastapi import Request
from fastapi.responses import JSONResponse


class OutOfStock(Exception):
    def __init__(self, sku: str):
        self.sku = sku


@app.exception_handler(OutOfStock)
async def out_of_stock_handler(request: Request, exc: OutOfStock):
    return JSONResponse(status_code=409, content={"detail": f"{exc.sku} is out of stock"})
```

Any `raise OutOfStock("A100")` anywhere during a request now becomes a 409.

## Validation errors

When input fails validation, FastAPI raises `RequestValidationError` and responds 422:

```json
{"detail": [{"type": "missing", "loc": ["body", "price"], "msg": "Field required", "input": {"name": "Bolt"}}]}
```

You can override the format with `@app.exception_handler(RequestValidationError)`, for example to return 400 with a simpler message, but keep the field locations: clients need them.

## 204 means no body

```python
from fastapi import Response

@app.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    items.pop(item_id, None)
    return Response(status_code=204)     # or simply return None
```

## Worked example: choosing the status code

Walk through each failure and ask "whose fault is it, and what should the client do?":

| Situation in Taskboard | Code | Client should… |
|---|---|---|
| `/tasks/abc` (not an int), title too long | 422 | fix the request |
| task 999 doesn't exist | 404 | stop asking, or refresh its list |
| another open task already has that title | 409 | rename and retry |
| moving a `done` task back to `todo` isn't allowed | 409 (or 422) | show the rule to the user |
| not logged in | 401 | log in |
| logged in, but not the task's owner | 403 | give up |
| database down | 503 | retry later |
| a bug in our code | 500 | report it |

## Worked example: domain exceptions

Raising `HTTPException` deep inside business logic couples it to the web layer. A cleaner pattern: raise a **domain** exception, and translate it to HTTP in one place:

```python
class TaskNotFound(Exception):
    def __init__(self, task_id: int):
        self.task_id = task_id


def find_task(task_id: int) -> dict:          # pure logic: no HTTP here
    for t in TASKS:
        if t["id"] == task_id:
            return t
    raise TaskNotFound(task_id)


@app.exception_handler(TaskNotFound)
async def task_not_found_handler(request: Request, exc: TaskNotFound):
    return JSONResponse(status_code=404, content={"detail": f"Task {exc.task_id} not found"})


@app.get("/tasks/{task_id}")
def get_task(task_id: int):
    return find_task(task_id)
```

`find_task` can now be reused by a CLI, a background job or a test, without any FastAPI imports, and every endpoint that calls it gets consistent 404s for free.

> [!plain] In plain English
> Raising an exception stops the function immediately. FastAPI catches `HTTPException` (and any exception you registered a handler for) and turns it into an error response.

## Common mistakes

> [!mistake] Returning instead of raising
> `return HTTPException(404)` sends the exception object as a 200 JSON body. You must `raise` it.

> [!mistake] Leaking internals in 500s
> Never put stack traces or SQL in error responses. Log them server-side with the request ID; send the client a generic message.

:::quiz
q: What does `return HTTPException(status_code=404)` (instead of raise) do?
- sends a 404
+ sends a 200 whose body is the serialized exception object
- crashes the server with 500
- sends a 422
why: Only raising the exception short-circuits into an error response.
:::

:::quiz
q: A client tries to register a username that already exists. Best status?
- 400
- 404
+ 409
- 500
why: 409 Conflict signals the request conflicts with current state.
:::

:::quiz
q: What does `@app.exception_handler(OutOfStock)` do?
+ Converts any OutOfStock raised during a request into the response the handler returns
- Catches only HTTPException
- Retries the request
- Logs the exception and returns 500
why: Exception handlers map exception types to responses, keeping HTTP concerns out of business code.
:::

:::quiz
q: What's the body of an HTTPException(404, detail="Item not found") response?
+ {"detail": "Item not found"}
- {"error": "Item not found", "status": 404}
- "Item not found"
- an empty body
why: FastAPI wraps detail in an object under the key "detail".
:::

:::exercise
id: fe-404
level: 1
title: Not found
mode: code
lang: python
file: main.py
---
Complete `read_user`: if `user_id` isn't a key of `users`, raise `HTTPException` with status **404** and detail `"User not found"`; otherwise return `users[user_id]`.
---starter
from fastapi import FastAPI, HTTPException

app = FastAPI()

users = {1: {"name": "Ada"}, 2: {"name": "Linus"}}


@app.get("/users/{user_id}")
def read_user(user_id: int):
    ...
---rule
if\s+user_id\s+not\s+in\s+users\s*:|if\s+users\.get\(\s*user_id\s*\)\s+is\s+None\s*:|if\s+not\s+users\.get\(\s*user_id\s*\)\s*:
Check whether the user exists
---rule
raise\s+HTTPException\(\s*(status_code\s*=\s*)?(404|status\.HTTP_404_NOT_FOUND)\s*,\s*detail\s*=\s*["']User not found["']
`raise HTTPException(status_code=404, detail="User not found")`
---rule
!return\s+HTTPException
Don't `return` the exception
---rule
return\s+users\[\s*user_id\s*\]
Return the user
---solution
from fastapi import FastAPI, HTTPException

app = FastAPI()

users = {1: {"name": "Ada"}, 2: {"name": "Linus"}}


@app.get("/users/{user_id}")
def read_user(user_id: int):
    if user_id not in users:
        raise HTTPException(status_code=404, detail="User not found")
    return users[user_id]
:::

:::exercise
id: fe-conflict
level: 2
title: Duplicate names
mode: code
lang: python
file: main.py
---
In `create_tag`, if `tag.name` is already in the `tags` set, raise a **409** using the `status` module constant and the detail `"Tag already exists"`. Otherwise add it and return `{"name": tag.name}` with status 201.
---starter
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

app = FastAPI()
tags = {"python", "docker"}


class Tag(BaseModel):
    name: str


@app.post("/tags", status_code=status.HTTP_201_CREATED)
def create_tag(tag: Tag):
    ...
---rule
if\s+tag\.name\s+in\s+tags\s*:
Check `tag.name in tags`
---rule
raise\s+HTTPException\(\s*(status_code\s*=\s*)?status\.HTTP_409_CONFLICT\s*,\s*detail\s*=\s*["']Tag already exists["']
Raise 409 with `status.HTTP_409_CONFLICT`
---rule
tags\.add\(\s*tag\.name\s*\)
Add the new tag
---rule
return\s*\{\s*["']name["']\s*:\s*tag\.name\s*\}
Return `{"name": tag.name}`
---solution
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

app = FastAPI()
tags = {"python", "docker"}


class Tag(BaseModel):
    name: str


@app.post("/tags", status_code=status.HTTP_201_CREATED)
def create_tag(tag: Tag):
    if tag.name in tags:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already exists")
    tags.add(tag.name)
    return {"name": tag.name}
:::

:::exercise
id: fe-401
level: 2
title: Unauthorized with a header
mode: code
lang: python
file: main.py
---
In `secret`, if `token` isn't `"letmein"`, raise **401** with detail `"Invalid token"` and the header `WWW-Authenticate: Bearer`. Otherwise return `{"secret": 42}`.
---starter
from fastapi import FastAPI, HTTPException

app = FastAPI()


@app.get("/secret")
def secret(token: str):
    ...
---rule
if\s+token\s*!=\s*["']letmein["']\s*:|if\s+not\s+token\s*==\s*["']letmein["']\s*:
Compare the token with `"letmein"`
---rule
raise\s+HTTPException\([^)]*(401|HTTP_401_UNAUTHORIZED)
Raise a 401
---rule
headers\s*=\s*\{\s*["']WWW-Authenticate["']\s*:\s*["']Bearer["']\s*\}
Include `headers={"WWW-Authenticate": "Bearer"}`
---rule
return\s*\{\s*["']secret["']\s*:\s*42\s*\}
Return `{"secret": 42}`
---solution
from fastapi import FastAPI, HTTPException

app = FastAPI()


@app.get("/secret")
def secret(token: str):
    if token != "letmein":
        raise HTTPException(status_code=401, detail="Invalid token", headers={"WWW-Authenticate": "Bearer"})
    return {"secret": 42}
:::

:::exercise
id: fe-handler
level: 3
title: A domain exception handler
mode: code
lang: python
file: main.py
---
Register an exception handler for `InsufficientFunds` that returns a `JSONResponse` with status **402** and content `{"detail": "Insufficient funds"}`.
---starter
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()


class InsufficientFunds(Exception):
    pass
---rule
@app\.exception_handler\(\s*InsufficientFunds\s*\)
`@app.exception_handler(InsufficientFunds)`
---rule
(async\s+)?def\s+\w+\(\s*request\s*:\s*Request\s*,\s*exc\s*:\s*InsufficientFunds\s*\)
Handler signature `(request: Request, exc: InsufficientFunds)`
---rule
return\s+JSONResponse\((?=[^)]*status_code\s*=\s*402)(?=[^)]*content\s*=\s*\{\s*["']detail["']\s*:\s*["']Insufficient funds["']\s*\})
Return `JSONResponse(status_code=402, content={"detail": "Insufficient funds"})`
---solution
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()


class InsufficientFunds(Exception):
    pass


@app.exception_handler(InsufficientFunds)
async def insufficient_funds_handler(request: Request, exc: InsufficientFunds):
    return JSONResponse(status_code=402, content={"detail": "Insufficient funds"})
:::

:::exercise
id: fe-204
level: 2
title: Delete with no content
mode: code
lang: python
file: main.py
---
Add `DELETE /notes/{note_id}`: return **404** (`"Note not found"`) if it doesn't exist, otherwise delete it from `notes` and respond **204** with no body.
---starter
from fastapi import FastAPI, HTTPException, Response

app = FastAPI()
notes = {1: "buy milk", 2: "call mom"}
---rule
@app\.delete\(\s*["']/notes/\{note_id\}["'][^)]*status_code\s*=\s*(204|status\.HTTP_204_NO_CONTENT)
`@app.delete("/notes/{note_id}", status_code=204)`
---rule
raise\s+HTTPException\([^)]*(404|HTTP_404_NOT_FOUND)[^)]*["']Note not found["']
Raise 404 `"Note not found"` for missing notes
---rule
del\s+notes\[\s*note_id\s*\]|notes\.pop\(\s*note_id
Remove the note
---rule
!return\s*\{
Don't return a JSON body
---solution
from fastapi import FastAPI, HTTPException, Response

app = FastAPI()
notes = {1: "buy milk", 2: "call mom"}


@app.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int):
    if note_id not in notes:
        raise HTTPException(status_code=404, detail="Note not found")
    del notes[note_id]
    return Response(status_code=204)
:::

:::exercise
id: fe-predict-raise
level: 1
title: Predict: the error body
mode: answer
---
```python
@app.get("/files/{name}")
def get_file(name: str):
    raise HTTPException(status_code=403, detail={"reason": "private", "file": name})
```

What JSON body does `GET /files/notes.txt` return?
---answer
{"detail": {"reason": "private", "file": "notes.txt"}}
---solution
{"detail": {"reason": "private", "file": "notes.txt"}}
:::

:::exercise
id: fe-predict-return
level: 2
title: Predict: return vs raise
mode: answer
---
```python
@app.get("/oops")
def oops():
    return HTTPException(status_code=404, detail="nope")
```

What **status code** does `GET /oops` produce?
---answer
200
---solution
200
:::

:::exercise
id: fe-predict-order
level: 3
title: Predict: which error wins?
mode: answer
---
```python
@app.get("/orders/{order_id}")
def read_order(order_id: int):
    if order_id > 1000:
        raise HTTPException(status_code=404, detail="No such order")
    return {"id": order_id}
```

What status code does `GET /orders/abc` return?
---answer
422
---solution
422
---explain
Validation happens before your function runs, so the `int` conversion fails first.
:::

:::exercise
id: proj-fa-05-404
level: 2
title: "Project 6: a real 404"
mode: code
lang: python
file: main.py
path: app/main.py
---
Fix `get_task`: if no task matches, **raise** `HTTPException` with status **404** and detail `"Task not found"` (use `status.HTTP_404_NOT_FOUND` or `404`).
---starter
from fastapi import FastAPI, HTTPException, status

app = FastAPI(title="Taskboard", version="0.1.0")
TASKS = [{"id": 1, "title": "Set up repo", "status": "done"}]


@app.get("/tasks/{task_id}")
def get_task(task_id: int):
    for task in TASKS:
        if task["id"] == task_id:
            return task
    return {"detail": "not found"}
---rule
raise\s+HTTPException\((?=[^)]*(404|HTTP_404_NOT_FOUND))(?=[^)]*["']Task not found["'])
`raise HTTPException(404, "Task not found")`
---rule
!return\s*\{\s*["']detail["']
No more 200 with an error body
---solution
from fastapi import FastAPI, HTTPException, status

app = FastAPI(title="Taskboard", version="0.1.0")
TASKS = [{"id": 1, "title": "Set up repo", "status": "done"}]


@app.get("/tasks/{task_id}")
def get_task(task_id: int):
    for task in TASKS:
        if task["id"] == task_id:
            return task
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
:::

:::exercise
id: proj-fa-05-domain
level: 3
title: "Project 6b: a domain exception"
mode: code
lang: python
file: main.py
path: app/main.py
---
Define `class DuplicateTitle(Exception)` and register an exception handler for it that returns a `JSONResponse` with status **409** and content `{"detail": "A task with this title already exists"}`. In `create_task`, raise `DuplicateTitle()` when any existing task has the same `title` as `data.title`.
---starter
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="Taskboard", version="0.1.0")
TASKS: list[dict] = []


class TaskCreate(BaseModel):
    title: str


@app.post("/tasks", status_code=201)
def create_task(data: TaskCreate):
    task = {"id": len(TASKS) + 1, "status": "todo", **data.model_dump()}
    TASKS.append(task)
    return task
---rule
class\s+DuplicateTitle\(\s*Exception\s*\)
`class DuplicateTitle(Exception)`
---rule
@app\.exception_handler\(\s*DuplicateTitle\s*\)
Register a handler
---rule
JSONResponse\((?=[^)]*status_code\s*=\s*(409|status\.HTTP_409_CONFLICT))(?=[^)]*A task with this title already exists)
409 with the message
---rule
any\(\s*\w+\[\s*["']title["']\s*\]\s*==\s*data\.title\s+for\s+\w+\s+in\s+TASKS\s*\)|for\s+(\w+)\s+in\s+TASKS\s*:\s*\n\s+if\s+\1\[\s*["']title["']\s*\]\s*==\s*data\.title
Check for an existing title
---rule
raise\s+DuplicateTitle\(\s*\)
`raise DuplicateTitle()`
---solution
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="Taskboard", version="0.1.0")
TASKS: list[dict] = []


class DuplicateTitle(Exception):
    pass


@app.exception_handler(DuplicateTitle)
async def duplicate_title_handler(request: Request, exc: DuplicateTitle):
    return JSONResponse(status_code=409, content={"detail": "A task with this title already exists"})


class TaskCreate(BaseModel):
    title: str


@app.post("/tasks", status_code=201)
def create_task(data: TaskCreate):
    if any(t["title"] == data.title for t in TASKS):
        raise DuplicateTitle()
    task = {"id": len(TASKS) + 1, "status": "todo", **data.model_dump()}
    TASKS.append(task)
    return task
:::
