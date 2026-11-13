---
id: fastapi-lifespan
title: Lifespan, files & streaming
summary: Startup and shutdown with the lifespan context manager and app.state, form data, file uploads with UploadFile, size and type checks, FileResponse, StreamingResponse, server-sent events and serving static files.
minutes: 35
---
> [!project] Taskboard, step 10: attachments and exports
> Teams attach screenshots and specs to tasks, and managers want a CSV of the board. This step adds a lifespan that prepares the database and upload folder at startup, file attachments, and a streaming CSV export.

## Startup and shutdown: lifespan

Some things should happen **once per process**, not once per request: opening a database connection pool, creating an HTTP client, loading a machine-learning model, warming a cache. FastAPI's answer is a **lifespan** function: an async context manager where code before `yield` runs at startup and code after it runs at shutdown.

```python title=main.py
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=5)     # startup
    app.state.model = load_model("model.bin")
    yield                                              # the app serves requests here
    await app.state.http.aclose()                      # shutdown


app = FastAPI(lifespan=lifespan)


@app.get("/predict")
async def predict(text: str, request: Request):
    return {"label": request.app.state.model.predict(text)}
```

- Store shared objects on **`app.state`** and read them from `request.app.state` (or wrap that in a dependency).
- If startup raises, the server refuses to start, so you fail fast instead of on the first request.
- Shutdown code runs on a graceful stop (SIGTERM from Docker or Kubernetes), so connections close cleanly.

> [!warn] `@app.on_event("startup")` is deprecated
> Older tutorials use `on_event("startup")` / `on_event("shutdown")`. They still work but are deprecated, and you can't mix them with `lifespan`. Use lifespan in new code.

In tests, `TestClient` runs the lifespan only when used as a context manager:

```python
def test_predict():
    with TestClient(app) as client:          # startup runs here
        assert client.get("/predict?text=hi").status_code == 200
    # shutdown runs here
```

## Form data

HTML forms and the OAuth2 password flow send `application/x-www-form-urlencoded`, not JSON. Read fields with `Form()` (this needs the `python-multipart` package):

```python
from typing import Annotated
from fastapi import Form

@app.post("/login")
def login(username: Annotated[str, Form()], password: Annotated[str, Form()]):
    return {"username": username}
```

A route can take form fields **or** a JSON body, not both: they're different encodings of the request body.

## File uploads

Uploads arrive as `multipart/form-data`. Declare an `UploadFile` parameter:

```python
from fastapi import File, HTTPException, UploadFile, status

ALLOWED = {"image/png", "image/jpeg"}
MAX_BYTES = 2 * 1024 * 1024


@app.post("/avatars", status_code=status.HTTP_201_CREATED)
async def upload_avatar(file: UploadFile):
    if file.content_type not in ALLOWED:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "PNG or JPEG only")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Max 2 MB")
    save(file.filename, data)
    return {"filename": file.filename, "size": len(data)}
```

`UploadFile` gives you `filename`, `content_type`, `size`, and async `read()`, `write()`, `seek()`, `close()`. It's backed by a **spooled temporary file**: small uploads stay in memory, big ones spill to disk, so a 2 GB upload doesn't need 2 GB of RAM.

| Declaration | You get |
|---|---|
| `file: UploadFile` | one file, streamed (preferred) |
| `files: list[UploadFile]` | several files from the same field |
| `data: Annotated[bytes, File()]` | the whole file as `bytes` in memory: only for small files |
| `file: UploadFile` + `title: Annotated[str, Form()]` | a file plus ordinary form fields in one request |

> [!warn] Never trust the client's filename or content type
> `file.filename` can be `../../etc/passwd`, and `content_type` is whatever the client claimed. Generate your own storage name (`uuid4().hex`), check the size while reading, and for anything security-sensitive check the actual bytes (the "magic number") rather than the declared type.

To read a large upload without holding it all in memory, read in chunks:

```python
async def save_upload(file: UploadFile, dest: Path) -> int:
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(413, "Too large")
            out.write(chunk)
    return size
```

## Sending files back: FileResponse

```python
from fastapi.responses import FileResponse

@app.get("/reports/{report_id}/pdf")
def download_report(report_id: int):
    path = REPORT_DIR / f"{report_id}.pdf"
    if not path.is_file():
        raise HTTPException(404, "Report not found")
    return FileResponse(path, media_type="application/pdf", filename=f"report-{report_id}.pdf")
```

`FileResponse` streams the file from disk and sets `Content-Length`, `Last-Modified` and `ETag`. Passing `filename=` adds `Content-Disposition: attachment`, so browsers download it instead of displaying it.

## Streaming responses

When the body is generated on the fly (a big CSV export, an LLM's tokens, a proxied download), don't build it all in memory. Return a `StreamingResponse` wrapping a generator:

```python
from fastapi.responses import StreamingResponse

def csv_rows():
    yield "id,name\n"
    for user in iter_all_users():        # one row at a time
        yield f"{user.id},{user.name}\n"


@app.get("/export.csv")
def export():
    return StreamingResponse(csv_rows(), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="users.csv"'})
```

The client starts receiving data immediately, and memory use stays flat however big the export is.

## Server-sent events

**Server-sent events (SSE)** are a simple one-way stream from server to browser over plain HTTP: the response has type `text/event-stream` and each message is a `data: …` line followed by a blank line. The browser's `EventSource` reconnects automatically. It's the usual transport for live notifications and for streaming LLM output token by token.

```python
import asyncio

async def ticks():
    for i in range(5):
        yield f"data: tick {i}\n\n"
        await asyncio.sleep(1)


@app.get("/events")
async def events():
    return StreamingResponse(ticks(), media_type="text/event-stream")
```

Use SSE when only the server talks. When both sides send messages, use WebSockets (next lessons).

## Static files

Mount a directory to serve files as-is (a built frontend, images, docs):

```python
from fastapi.staticfiles import StaticFiles

app.mount("/static", StaticFiles(directory="static"), name="static")
```

`mount` attaches a whole sub-application at a path prefix; routes under `/static` never reach your path operations. In production, a CDN or nginx in front of the app usually serves static files more efficiently.

## Worked example: where Taskboard does its startup work

```python title=main.py
from contextlib import asynccontextmanager
from pathlib import Path

UPLOAD_DIR = Path("uploads")

@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOAD_DIR.mkdir(exist_ok=True)                 # once, at startup
    SQLModel.metadata.create_all(engine)            # demo-friendly; Alembic in production
    yield
    engine.dispose()                                # close pooled DB connections on shutdown

app = FastAPI(title="Taskboard", version="0.4.0", lifespan=lifespan)
```

Before lifespan existed, people did this at **import time** (top-level code in `main.py`), which runs even when a test merely imports the module, and has no shutdown hook.

## Worked example: a safe attachment endpoint

```python
@router.post("/{task_id}/attachments", status_code=201)
async def add_attachment(task_id: int, file: UploadFile, session: SessionDep):
    task = session.get(Task, task_id) or raise_404()
    if file.content_type not in {"image/png", "image/jpeg", "application/pdf"}:
        raise HTTPException(415, "PNG, JPEG or PDF only")
    stored_name = f"{uuid4().hex}{Path(file.filename or '').suffix.lower()}"
    size = await save_upload(file, UPLOAD_DIR / stored_name)       # chunked, enforces a size cap
    return {"task_id": task.id, "file": stored_name, "size": size}
```

Every choice there defends against something: an allow-list of types, a **server-generated** name (no `../../` tricks, no collisions), and a chunked save with a size cap so one huge upload can't fill the disk or memory.

> [!plain] In plain English
> Uploads arrive as `multipart/form-data`, not JSON. `UploadFile` gives you the file's name, type and a way to read it in pieces. Never trust what the client says about its file.

## Common mistakes

> [!mistake] Storing uploads inside the container
> In Docker, files written to the container's filesystem disappear when it's replaced. Use a volume locally and object storage (S3) in production. The AWS track moves Taskboard's attachments to S3 with presigned URLs.

:::quiz
q: In a lifespan function, when does the code **after** `yield` run?
- before the first request
- after every request
+ once, when the application shuts down
- only if startup failed
why: Lifespan wraps the whole life of the app: before yield is startup, after yield is shutdown.
:::

:::quiz
q: Why is `UploadFile` usually better than `bytes = File()`?
+ it spools to disk for large files and can be read in chunks, instead of loading the whole file into memory
- it's the only way to get the filename
- `bytes` uploads are not supported by FastAPI
- it validates the file type automatically
why: `bytes` forces the entire upload into RAM. `UploadFile` is a spooled temp file with an async API.
:::

:::quiz
q: Which media type does a server-sent events endpoint return?
- application/json
- multipart/form-data
+ text/event-stream
- application/octet-stream
why: SSE is a stream of `data:` lines with media type `text/event-stream`, consumed in the browser by `EventSource`.
:::

:::quiz
q: A client uploads a file and claims `content_type: image/png`. What does that prove?
- that the file is a PNG
- that the file is under 2 MB
+ nothing; the client chose that header
- that it was virus-scanned
why: Content type and filename come from the client. Validate size and, when it matters, the actual bytes.
:::

:::exercise
id: fl-lifespan
level: 2
title: A lifespan with a shared client
mode: code
lang: python
file: main.py
---
Write an `@asynccontextmanager` function `lifespan(app: FastAPI)` that stores `httpx.AsyncClient()` in `app.state.client` at startup, yields, and closes it with `await app.state.client.aclose()` at shutdown. Pass it to `FastAPI(lifespan=lifespan)`.
---starter
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

app = FastAPI()
---rule
@asynccontextmanager\s*\nasync\s+def\s+lifespan\(\s*app(\s*:\s*FastAPI)?\s*\)
`@asynccontextmanager` on `async def lifespan(app: FastAPI)`
---rule
app\.state\.client\s*=\s*httpx\.AsyncClient\(
Create the client on `app.state.client`
---rule
^\s+yield\s*$
`yield` between startup and shutdown
---rule
await\s+app\.state\.client\.aclose\(\s*\)
Close it after `yield`
---rule
app\s*=\s*FastAPI\([^)]*lifespan\s*=\s*lifespan
`FastAPI(lifespan=lifespan)`
---rule
yield[\s\S]*aclose
The close happens after `yield`
---solution
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = httpx.AsyncClient()
    yield
    await app.state.client.aclose()


app = FastAPI(lifespan=lifespan)
:::

:::exercise
id: fl-state
level: 2
title: Read shared state
mode: code
lang: python
file: main.py
---
The lifespan already loads `app.state.settings` (a dict). Add `GET /config/name` that takes `request: Request` and returns `{"name": request.app.state.settings["name"]}`.
---starter
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.settings = {"name": "prac"}
    yield


app = FastAPI(lifespan=lifespan)
---rule
@app\.get\(\s*["']/config/name["']\s*\)
`GET /config/name`
---rule
def\s+\w+\(\s*request\s*:\s*Request\s*\)
Take `request: Request`
---rule
request\.app\.state\.settings\[\s*["']name["']\s*\]
Read `request.app.state.settings["name"]`
---solution
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.settings = {"name": "prac"}
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/config/name")
def config_name(request: Request):
    return {"name": request.app.state.settings["name"]}
:::

:::exercise
id: fl-form
level: 1
title: A form login
mode: code
lang: python
file: main.py
---
Write `POST /login` that reads `username` and `password` as **form fields** (`Annotated[str, Form()]`) and returns `{"user": username}`.
---starter
from typing import Annotated

from fastapi import FastAPI, Form

app = FastAPI()
---rule
@app\.post\(\s*["']/login["']
`POST /login`
---rule
username\s*:\s*Annotated\[\s*str\s*,\s*Form\(\s*\)\s*\]
`username: Annotated[str, Form()]`
---rule
password\s*:\s*Annotated\[\s*str\s*,\s*Form\(\s*\)\s*\]
`password: Annotated[str, Form()]`
---rule
return\s*\{\s*["']user["']\s*:\s*username\s*\}
Return `{"user": username}`
---solution
from typing import Annotated

from fastapi import FastAPI, Form

app = FastAPI()


@app.post("/login")
def login(username: Annotated[str, Form()], password: Annotated[str, Form()]):
    return {"user": username}
:::

:::exercise
id: fl-upload
level: 3
title: Validate an upload
mode: code
lang: python
file: main.py
---
Write `async def upload(file: UploadFile)` for `POST /uploads` (status **201**) that:

- raises **415** `"CSV only"` unless `file.content_type == "text/csv"`,
- reads the content with `await file.read()`,
- raises **413** `"Too large"` if it's longer than `MAX_BYTES`,
- returns `{"filename": file.filename, "size": <number of bytes>}`.
---starter
from fastapi import FastAPI, HTTPException, UploadFile

app = FastAPI()
MAX_BYTES = 1_000_000
---rule
@app\.post\(\s*["']/uploads["'][^)]*status_code\s*=\s*(201|status\.HTTP_201_CREATED)
`POST /uploads` with status 201
---rule
async\s+def\s+upload\(\s*file\s*:\s*UploadFile\s*\)
`async def upload(file: UploadFile)`
---rule
file\.content_type\s*!=\s*["']text/csv["']|["']text/csv["']\s*!=\s*file\.content_type|file\.content_type\s+not\s+in
Check the content type
---rule
HTTPException\([^)]*415[^)]*CSV only|HTTPException\([^)]*UNSUPPORTED_MEDIA_TYPE[^)]*CSV only
415 `"CSV only"`
---rule
=\s*await\s+file\.read\(\s*\)
`await file.read()`
---rule
len\(\s*\w+\s*\)\s*>\s*MAX_BYTES
Compare the size with `MAX_BYTES`
---rule
HTTPException\([^)]*413[^)]*Too large|HTTPException\([^)]*TOO_LARGE[^)]*Too large
413 `"Too large"`
---rule
["']filename["']\s*:\s*file\.filename
Return the filename
---solution
from fastapi import FastAPI, HTTPException, UploadFile

app = FastAPI()
MAX_BYTES = 1_000_000


@app.post("/uploads", status_code=201)
async def upload(file: UploadFile):
    if file.content_type != "text/csv":
        raise HTTPException(status_code=415, detail="CSV only")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Too large")
    return {"filename": file.filename, "size": len(data)}
:::

:::exercise
id: fl-multi
level: 2
title: Many files plus a field
mode: code
lang: python
file: main.py
---
Write `POST /albums` that accepts a form field `title: Annotated[str, Form()]` and several files `photos: list[UploadFile]`, and returns `{"title": title, "count": len(photos)}`.
---starter
from typing import Annotated

from fastapi import FastAPI, Form, UploadFile

app = FastAPI()
---rule
@app\.post\(\s*["']/albums["']
`POST /albums`
---rule
title\s*:\s*Annotated\[\s*str\s*,\s*Form\(\s*\)\s*\]
`title` is a form field
---rule
photos\s*:\s*(list|List)\[\s*UploadFile\s*\]
`photos: list[UploadFile]`
---rule
["']count["']\s*:\s*len\(\s*photos\s*\)
Return the number of photos
---solution
from typing import Annotated

from fastapi import FastAPI, Form, UploadFile

app = FastAPI()


@app.post("/albums")
async def create_album(title: Annotated[str, Form()], photos: list[UploadFile]):
    return {"title": title, "count": len(photos)}
:::

:::exercise
id: fl-file-response
level: 2
title: Download an invoice
mode: code
lang: python
file: main.py
---
Write `GET /invoices/{invoice_id}` (`invoice_id: int`) that returns 404 `"Invoice not found"` if `INVOICES / f"{invoice_id}.pdf"` isn't a file, and otherwise a `FileResponse` for it with `media_type="application/pdf"` and `filename=f"invoice-{invoice_id}.pdf"`.
---starter
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

app = FastAPI()
INVOICES = Path("invoices")
---rule
@app\.get\(\s*["']/invoices/\{invoice_id\}["']\s*\)
`GET /invoices/{invoice_id}`
---rule
invoice_id\s*:\s*int
`invoice_id: int`
---rule
\.is_file\(\s*\)|\.exists\(\s*\)
Check the file exists
---rule
HTTPException\([^)]*404[^)]*Invoice not found|HTTPException\([^)]*NOT_FOUND[^)]*Invoice not found
404 `"Invoice not found"`
---rule
return\s+FileResponse\((?=[^)]*media_type\s*=\s*["']application/pdf["'])(?=[^)]*filename\s*=\s*f["']invoice-\{invoice_id\}\.pdf["'])
`FileResponse(..., media_type="application/pdf", filename=f"invoice-{invoice_id}.pdf")`
---solution
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

app = FastAPI()
INVOICES = Path("invoices")


@app.get("/invoices/{invoice_id}")
def download_invoice(invoice_id: int):
    path = INVOICES / f"{invoice_id}.pdf"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Invoice not found")
    return FileResponse(path, media_type="application/pdf", filename=f"invoice-{invoice_id}.pdf")
:::

:::exercise
id: fl-stream
level: 3
title: Stream a big export
mode: code
lang: python
file: main.py
---
Write a generator `rows()` that yields the header line `"sku,qty\n"` and then one line `f"{sku},{qty}\n"` per item in `STOCK.items()`. Expose it at `GET /stock.csv` as a `StreamingResponse` with `media_type="text/csv"`.
---starter
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()
STOCK = {"A1": 4, "B2": 0, "C3": 12}
---rule
def\s+rows\(\s*\)\s*:
`def rows():`
---rule
yield\s+["']sku,qty\\n["']
Yield the header first
---rule
for\s+sku\s*,\s*qty\s+in\s+STOCK\.items\(\s*\)\s*:\s*\n\s+yield\s+f["']\{sku\},\{qty\}\\n["']
Yield one line per item
---rule
@app\.get\(\s*["']/stock\.csv["']\s*\)
`GET /stock.csv`
---rule
StreamingResponse\(\s*rows\(\s*\)\s*,\s*media_type\s*=\s*["']text/csv["']
`StreamingResponse(rows(), media_type="text/csv")`
---solution
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()
STOCK = {"A1": 4, "B2": 0, "C3": 12}


def rows():
    yield "sku,qty\n"
    for sku, qty in STOCK.items():
        yield f"{sku},{qty}\n"


@app.get("/stock.csv")
def stock_csv():
    return StreamingResponse(rows(), media_type="text/csv")
:::

:::exercise
id: fl-static
level: 1
title: Serve a frontend
mode: code
lang: python
file: main.py
---
Serve the files in the `dist` directory under the URL prefix `/app`, with the mount named `"app"`.
---starter
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()
---rule
app\.mount\(\s*["']/app["']\s*,\s*StaticFiles\(\s*directory\s*=\s*["']dist["']\s*\)\s*,\s*name\s*=\s*["']app["']\s*\)
`app.mount("/app", StaticFiles(directory="dist"), name="app")`
---solution
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()
app.mount("/app", StaticFiles(directory="dist"), name="app")
:::

:::exercise
id: fl-predict-testclient
level: 3
title: Predict: lifespan in tests
mode: answer
---
```python
@asynccontextmanager
async def lifespan(app):
    app.state.ready = True
    yield

app = FastAPI(lifespan=lifespan)

@app.get("/ready")
def ready(request: Request):
    return {"ready": getattr(request.app.state, "ready", False)}

client = TestClient(app)
print(client.get("/ready").json())
```

What does it print? (The test does **not** use `with TestClient(app) as client`.)
---answer
{"ready": false}
---answer
{'ready': False}
---solution
{"ready": false}
---explain
Without the `with` block, TestClient doesn't run the lifespan, so `app.state.ready` was never set.
:::

:::exercise
id: proj-fa-10-lifespan
level: 3
title: "Project 10: Taskboard's lifespan"
mode: code
lang: python
file: main.py
---
Write an `@asynccontextmanager` `lifespan(app: FastAPI)` that creates the upload folder with `UPLOAD_DIR.mkdir(exist_ok=True)` and the tables with `SQLModel.metadata.create_all(engine)` before `yield`, and calls `engine.dispose()` after it. Pass it to the app.
---starter
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from sqlmodel import SQLModel

from db import engine

UPLOAD_DIR = Path("uploads")
app = FastAPI(title="Taskboard", version="0.4.0")
---rule
@asynccontextmanager\s*\nasync\s+def\s+lifespan\(\s*app(\s*:\s*FastAPI)?\s*\)
The lifespan function
---rule
UPLOAD_DIR\.mkdir\(\s*exist_ok\s*=\s*True\s*\)
Create the upload folder
---rule
SQLModel\.metadata\.create_all\(\s*engine\s*\)
Create the tables
---rule
yield\s*\n\s+engine\.dispose\(\s*\)
Dispose the engine after `yield`
---rule
mkdir[\s\S]*yield|create_all[\s\S]*yield
Startup work before `yield`
---rule
app\s*=\s*FastAPI\([^)]*lifespan\s*=\s*lifespan
`FastAPI(..., lifespan=lifespan)`
---solution
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from sqlmodel import SQLModel

from db import engine

UPLOAD_DIR = Path("uploads")


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOAD_DIR.mkdir(exist_ok=True)
    SQLModel.metadata.create_all(engine)
    yield
    engine.dispose()


app = FastAPI(title="Taskboard", version="0.4.0", lifespan=lifespan)
:::

:::exercise
id: proj-fa-10-export
level: 3
title: "Project 10b: CSV export"
mode: code
lang: python
file: routers/export.py
---
Write a generator `task_rows(tasks)` that yields `"id,title,status\n"` and then `f"{t.id},{t.title},{t.status}\n"` for each task. Add `GET /tasks.csv` that loads `session.exec(select(Task).order_by(Task.id)).all()` and returns `StreamingResponse(task_rows(tasks), media_type="text/csv")`.
---starter
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlmodel import select

from db import SessionDep, Task

router = APIRouter()
---rule
def\s+task_rows\(\s*tasks\s*\)\s*:
`def task_rows(tasks):`
---rule
yield\s+["']id,title,status\\n["']
Header row first
---rule
for\s+(\w+)\s+in\s+tasks\s*:\s*\n\s+yield\s+f["']\{\1\.id\},\{\1\.title\},\{\1\.status\}\\n["']
One row per task
---rule
@router\.get\(\s*["']/tasks\.csv["']\s*\)
`GET /tasks.csv`
---rule
session\.exec\(\s*select\(\s*Task\s*\)\.order_by\(\s*Task\.id\s*\)\s*\)\.all\(\s*\)
Load the tasks in id order
---rule
StreamingResponse\(\s*task_rows\(\s*\w+\s*\)\s*,\s*media_type\s*=\s*["']text/csv["']\s*\)
Stream it as CSV
---solution
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlmodel import select

from db import SessionDep, Task

router = APIRouter()


def task_rows(tasks):
    yield "id,title,status\n"
    for t in tasks:
        yield f"{t.id},{t.title},{t.status}\n"


@router.get("/tasks.csv")
def export_tasks(session: SessionDep):
    tasks = session.exec(select(Task).order_by(Task.id)).all()
    return StreamingResponse(task_rows(tasks), media_type="text/csv")
:::
