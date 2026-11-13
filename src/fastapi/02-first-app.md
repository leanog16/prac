---
id: fastapi-first
title: Your first FastAPI app
summary: What FastAPI is built on, creating the app object, path operations with decorators, returning JSON, running with uvicorn, the automatic /docs, and def vs async def.
minutes: 25
---
## What FastAPI is

**FastAPI** is a Python web framework for building APIs. It stands on two libraries:

- **Starlette**: the ASGI web toolkit (routing, requests, responses, middleware).
- **Pydantic**: data validation and serialization using Python **type hints**.

Your type hints aren't decoration: FastAPI reads them to parse and validate input, convert types, serialize output and generate OpenAPI documentation automatically.

## The smallest app

```python title=main.py
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}
```

- `app = FastAPI()` creates the application (an ASGI app).
- `@app.get("/")` registers a **path operation**: the function handles `GET /`.
- Returning a dict (or list, or Pydantic model) sends **JSON** with status 200.

Run it with an ASGI server:

```bash
pip install "fastapi[standard]"      # fastapi + uvicorn + extras
uvicorn main:app --reload             # module "main", variable "app"
# or: fastapi dev main.py
```

`main:app` means "import module `main`, use the variable `app`". `--reload` restarts on code changes (development only).

## Automatic docs

Without writing anything else you get:

| URL | What |
|---|---|
| `/docs` | Swagger UI: interactive docs where you can try every endpoint |
| `/redoc` | ReDoc: alternative docs view |
| `/openapi.json` | the machine-readable OpenAPI schema everything is generated from |

## One decorator per method

```python
@app.get("/items")          # read
@app.post("/items")         # create
@app.put("/items/{id}")     # replace
@app.patch("/items/{id}")   # partial update
@app.delete("/items/{id}")  # delete
```

Each decorator takes the path, and optional settings like `status_code=201`, `tags=["items"]`, `summary="..."`, `response_model=...`.

## def or async def?

```python
@app.get("/slow-io")
async def read_async():
    data = await some_async_client.get("...")   # non-blocking I/O with await
    return data

@app.get("/plain")
def read_sync():
    return {"ok": True}                          # FastAPI runs this in a threadpool
```

Use `async def` when you `await` async libraries (httpx, async DB drivers). Use plain `def` when you call blocking code (requests, most ORMs); FastAPI runs it in a worker thread so the event loop isn't blocked. **Never call blocking code inside `async def`**: it stalls every request.

> [!note] How these exercises are graded
> There's no Python runtime in your browser, so FastAPI code exercises are checked against a **requirement checklist** (the right decorator, path, parameter types, return value…). Click "Show requirements" to see the list before you start. Predict-the-response exercises ask what a real FastAPI app would return.

:::quiz
q: In `uvicorn main:app`, what is `app`?
- the folder name
- the uvicorn worker name
+ the FastAPI instance variable inside main.py
- a command-line flag
why: module:variable. uvicorn imports main and serves the object named app.
:::

:::quiz
q: Which library does FastAPI use for validating request data?
- Flask
+ Pydantic
- Django REST Framework
- marshmallow
why: FastAPI uses Pydantic models and type hints for validation and serialization; Starlette handles the web layer.
:::

:::quiz
q: Where are the interactive docs of a FastAPI app served by default?
+ /docs
- /swagger.json
- /api
- /help
why: /docs (Swagger UI) and /redoc, generated from /openapi.json.
:::

:::quiz
q: A handler calls the blocking `requests.get(...)`. How should it be declared?
+ `def handler():` so FastAPI runs it in a threadpool
- `async def handler():` for speed
- either; it makes no difference
- it must be a class
why: Blocking calls inside async def freeze the event loop. A plain def is offloaded to a thread.
:::

:::exercise
id: fa-hello
level: 1
title: Hello endpoint
mode: code
lang: python
file: main.py
---
Add a `GET /hello` endpoint that returns `{"message": "Hello, world"}`.
---starter
from fastapi import FastAPI

app = FastAPI()
---rule
@app\.get\(\s*["']/hello["']
A `GET` route for `/hello` with `@app.get("/hello")`
---rule
^def\s+\w+\(\s*\)\s*:|^async\s+def\s+\w+\(\s*\)\s*:
A handler function (with no parameters) right under the decorator
---rule
return\s*\{\s*["']message["']\s*:\s*["']Hello, world["']\s*\}
It returns `{"message": "Hello, world"}`
---solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/hello")
def hello():
    return {"message": "Hello, world"}
:::

:::exercise
id: fa-create-app
level: 1
title: Create the app
mode: code
lang: python
file: main.py
---
Write a complete `main.py`: import `FastAPI`, create an app named `app` with the title `Inventory API`, and add `GET /health` returning `{"status": "ok"}`.
---hint
`FastAPI(title="Inventory API")`
---rule
from\s+fastapi\s+import\s+[^\n]*\bFastAPI\b
Import `FastAPI` from `fastapi`
---rule
^app\s*=\s*FastAPI\(\s*title\s*=\s*["']Inventory API["']\s*\)
Create `app = FastAPI(title="Inventory API")`
---rule
@app\.get\(\s*["']/health["']
A `GET /health` route
---rule
return\s*\{\s*["']status["']\s*:\s*["']ok["']\s*\}
Return `{"status": "ok"}`
---solution
from fastapi import FastAPI

app = FastAPI(title="Inventory API")


@app.get("/health")
def health():
    return {"status": "ok"}
:::

:::exercise
id: fa-version
level: 1
title: A version endpoint
mode: code
lang: python
file: main.py
---
Add `GET /version` that returns a dict with `"name": "inventory"` and `"version": "1.0.0"`.
---starter
from fastapi import FastAPI

app = FastAPI()
---rule
@app\.get\(\s*["']/version["']
A `GET /version` route
---rule
return\s*\{[^}]*["']name["']\s*:\s*["']inventory["']
The returned dict includes `"name": "inventory"`
---rule
return\s*\{[^}]*["']version["']\s*:\s*["']1\.0\.0["']
The returned dict includes `"version": "1.0.0"`
---solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/version")
def version():
    return {"name": "inventory", "version": "1.0.0"}
:::

:::exercise
id: fa-list
level: 2
title: Return a list
mode: code
lang: python
file: main.py
---
Add `GET /colors` that returns the JSON array `["red", "green", "blue"]`.
---starter
from fastapi import FastAPI

app = FastAPI()
---rule
@app\.get\(\s*["']/colors["']
A `GET /colors` route
---rule
return\s*\[\s*["']red["']\s*,\s*["']green["']\s*,\s*["']blue["']\s*,?\s*\]
Return the list `["red", "green", "blue"]`
---solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/colors")
def colors():
    return ["red", "green", "blue"]
:::

:::exercise
id: fa-post-status
level: 2
title: A POST that says 201
mode: code
lang: python
file: main.py
---
Add `POST /ping` that responds with status **201** and body `{"pong": true}`. Set the status code in the decorator.
---starter
from fastapi import FastAPI

app = FastAPI()
---rule
@app\.post\(\s*["']/ping["']
A `POST /ping` route
---rule
@app\.post\([^)]*status_code\s*=\s*(201|status\.HTTP_201_CREATED)
`status_code=201` in the decorator
---rule
return\s*\{\s*["']pong["']\s*:\s*True\s*\}
Return `{"pong": True}` (Python's `True` becomes JSON `true`)
---solution
from fastapi import FastAPI

app = FastAPI()


@app.post("/ping", status_code=201)
def ping():
    return {"pong": True}
:::

:::exercise
id: fa-async
level: 2
title: An async endpoint
mode: code
lang: python
file: main.py
---
Write `GET /quote` as an **async** function that awaits `fetch_quote()` (already defined, returns a string) and returns `{"quote": <that string>}`.
---starter
from fastapi import FastAPI

app = FastAPI()


async def fetch_quote() -> str:
    return "Simple is better than complex."
---rule
@app\.get\(\s*["']/quote["']
A `GET /quote` route
---rule
async\s+def\s+\w+\(\s*\)\s*:[\s\S]*?await\s+fetch_quote\(\)
An `async def` handler that `await`s `fetch_quote()`
---rule
return\s*\{\s*["']quote["']\s*:\s*\w+\s*\}|return\s*\{\s*["']quote["']\s*:\s*await\s+fetch_quote\(\)\s*\}
Return `{"quote": ...}` with the fetched text
---solution
from fastapi import FastAPI

app = FastAPI()


async def fetch_quote() -> str:
    return "Simple is better than complex."


@app.get("/quote")
async def quote():
    text = await fetch_quote()
    return {"quote": text}
:::

:::exercise
id: fa-run-cmd
level: 1
title: Start the server
mode: answer
---
Your app object is `api` inside the file `server.py`. Write the uvicorn command that serves it with auto-reload.
---answer
uvicorn server:api --reload
---solution
uvicorn server:api --reload
:::

:::exercise
id: fa-docs-url
level: 1
title: Find the docs
mode: answer
---
The app runs at `http://127.0.0.1:8000`. What URL opens the interactive Swagger UI?
---answer
http://127.0.0.1:8000/docs
---answer
127.0.0.1:8000/docs
---answer
/docs
---solution
http://127.0.0.1:8000/docs
:::

:::exercise
id: fa-predict-root
level: 2
title: Predict the body
mode: answer
---
```python
@app.get("/")
def root():
    return {"service": "inventory", "ready": True, "items": 0, "owner": None}
```

What JSON body does `GET /` return?
---answer
{"service": "inventory", "ready": true, "items": 0, "owner": null}
---solution
{"service": "inventory", "ready": true, "items": 0, "owner": null}
:::

:::exercise
id: fa-three-routes
level: 3
title: A tiny API surface
mode: code
lang: python
file: main.py
---
In one file, create `app` and three routes: `GET /` returning `{"app": "todo"}`, `GET /todos` returning an empty list, and `DELETE /todos` responding with status **204** and returning nothing (`None`).
---rule
^app\s*=\s*FastAPI\(
Create the `app`
---rule
@app\.get\(\s*["']/["']\s*\)
`GET /`
---rule
return\s*\{\s*["']app["']\s*:\s*["']todo["']\s*\}
`/` returns `{"app": "todo"}`
---rule
@app\.get\(\s*["']/todos["'][\s\S]*?return\s*\[\s*\]
`GET /todos` returns `[]`
---rule
@app\.delete\(\s*["']/todos["'][^)]*status_code\s*=\s*(204|status\.HTTP_204_NO_CONTENT)
`DELETE /todos` with `status_code=204`
---solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def root():
    return {"app": "todo"}


@app.get("/todos")
def list_todos():
    return []


@app.delete("/todos", status_code=204)
def clear_todos():
    return None
:::
