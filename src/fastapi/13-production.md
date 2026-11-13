---
id: fastapi-prod
title: Security & production
summary: Issuing and verifying JWTs with expiry, password hashing, OAuth2 scopes with Security, rate limiting, caching with ETag and Cache-Control, request IDs and structured logging, health and readiness checks, workers and proxy headers, and API versioning.
minutes: 45
---
> [!project] Taskboard, step 13: production-ready
> Taskboard replaces its demo API keys with a real login that issues JWTs, adds request IDs to every log line, and splits health into liveness and readiness. After this step it's ready for the Docker track to containerize.

## JWT access tokens, end to end

The dependency lesson sketched `create_jwt` and `decode_jwt`. Here is a complete, correct version with **PyJWT** and **pwdlib** (argon2):

```python title=security.py
from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

SECRET_KEY = settings.secret_key          # long random string from the environment
ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 15

password_hash = PasswordHash.recommended()   # argon2


def hash_password(plain: str) -> str:
    return password_hash.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return password_hash.verify(plain, hashed)


def create_access_token(username: str, scopes: list[str]) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": username, "scopes": scopes, "iat": now,
               "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

```python title=deps.py
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:            # bad signature, expired, malformed…
        raise CREDENTIALS_ERROR
    user = users.get(payload.get("sub"))
    if user is None:
        raise CREDENTIALS_ERROR
    return user
```

Things that matter:

- **`algorithms=[ALGORITHM]` is a list and is required.** Accepting whatever algorithm the token header names has caused real vulnerabilities (the `alg: none` attack).
- `jwt.decode` **checks `exp` for you** and raises `ExpiredSignatureError` (a subclass of `InvalidTokenError`).
- A JWT is **signed, not encrypted**. Anyone can base64-decode the payload, so never put secrets or personal data in it.
- Keep access tokens short-lived (5–30 min) and issue a longer-lived **refresh token** to get new ones. Logging out means the client discards the tokens; revoking one early needs a server-side denylist.
- Use the same error for "no such user" and "wrong password" so attackers can't enumerate accounts.

## Scopes: fine-grained permissions

OAuth2 **scopes** are permission strings carried in the token (`"items:read"`, `"items:write"`). FastAPI checks them with `Security`, which is `Depends` plus a list of required scopes:

```python
from fastapi import Security
from fastapi.security import OAuth2PasswordBearer, SecurityScopes

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="token",
    scopes={"items:read": "Read items", "items:write": "Create and edit items"},
)


def get_current_user(security_scopes: SecurityScopes,
                     token: Annotated[str, Depends(oauth2_scheme)]) -> User:
    payload = decode_or_401(token)
    granted = set(payload.get("scopes", []))
    for scope in security_scopes.scopes:
        if scope not in granted:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not enough permissions",
                                headers={"WWW-Authenticate": f'Bearer scope="{security_scopes.scope_str}"'})
    return users[payload["sub"]]


@app.post("/items")
def create_item(item: ItemIn, user: Annotated[User, Security(get_current_user, scopes=["items:write"])]):
    ...
```

**401** means "I don't know who you are" (missing or invalid token). **403** means "I know who you are, and you're not allowed".

## Rate limiting

Without a limit, one client (or attacker) can exhaust your workers, your database or your paid upstream API. The common library is **slowapi**:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, storage_uri="redis://redis:6379")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.post("/token")
@limiter.limit("5/minute")
def login(request: Request, form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    ...
```

- Exceeding the limit returns **429 Too Many Requests**, ideally with a `Retry-After` header.
- Store counters in **Redis** when you run more than one worker; in-memory counters are per process.
- Limit login and password-reset endpoints hardest. They're the brute-force targets.
- Behind a proxy, key by the real client IP (see proxy headers below), or every request looks like it comes from the load balancer.

## Caching: Cache-Control and ETag

**`Cache-Control`** tells browsers and CDNs how long they may reuse a response without asking again:

```python
@app.get("/countries")
def countries(response: Response):
    response.headers["Cache-Control"] = "public, max-age=3600"
    return COUNTRIES
```

An **ETag** is a fingerprint of a response. The client sends it back as `If-None-Match`; if nothing changed, answer **304 Not Modified** with no body:

```python
import hashlib, json

@app.get("/catalog")
def catalog(request: Request):
    body = json.dumps(load_catalog(), sort_keys=True)
    etag = '"' + hashlib.sha256(body.encode()).hexdigest()[:16] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(body, media_type="application/json", headers={"ETag": etag})
```

For data that's expensive to compute, cache it **server-side** too (Redis with a TTL, or `functools.lru_cache` for pure functions). Cache keys must include everything that changes the answer (user, query parameters), or one user sees another's data.

## Request IDs and structured logging

When something fails in production, you need to find **every** log line from that one request across services. Give each request an ID, return it in a header, and include it in logs:

```python
import logging, time, uuid

logger = logging.getLogger("api")


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info("request", extra={"request_id": request_id, "method": request.method,
                                  "path": request.url.path, "status": response.status_code,
                                  "duration_ms": round(duration_ms, 1)})
    return response
```

Log as **JSON** (`python-json-logger`, `structlog`) so log platforms can filter by field. Never log passwords, tokens or full request bodies. For metrics and traces, **OpenTelemetry** instruments FastAPI automatically (`opentelemetry-instrumentation-fastapi`), and `prometheus-fastapi-instrumentator` exposes a `/metrics` endpoint.

## Health and readiness

Orchestrators ask two different questions:

| Endpoint | Question | Should check |
|---|---|---|
| `/health` (liveness) | Is the process alive? If not, restart it. | nothing external, just return 200 fast |
| `/ready` (readiness) | Can it serve traffic right now? If not, stop sending requests. | database ping, required dependencies |

```python
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
async def ready(session: Annotated[AsyncSession, Depends(get_session)]):
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(503, "database unavailable")
    return {"status": "ready"}
```

Don't check the database in the **liveness** probe: a database blip would make the orchestrator restart every healthy API container at once.

## Running in production

```bash
# one container, several worker processes
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers --forwarded-allow-ips="*"

# or gunicorn managing uvicorn workers
gunicorn main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8000 --timeout 30
```

- **Workers**: each is a separate process with its own event loop and memory. A common starting point is 2–4 per CPU core. In Kubernetes or ECS, many teams run **one** worker per container and scale with replicas.
- **No `--reload`** in production; it's for development only.
- **Proxy headers**: behind a load balancer, the app sees the proxy's IP and `http://`. `--proxy-headers` trusts `X-Forwarded-For`/`X-Forwarded-Proto` so `request.client.host` and generated URLs are correct. Only trust them from your own proxy (`--forwarded-allow-ips`).
- **CORS**: list exact origins in production, not `"*"`, especially with `allow_credentials=True`.
- **Docs**: consider `FastAPI(docs_url=None, redoc_url=None)` or protecting `/docs` on public APIs.
- **Graceful shutdown**: uvicorn finishes in-flight requests on SIGTERM; make sure your container's stop timeout is longer than your slowest request.

## Versioning an API

Once clients depend on your API, breaking changes need a new version. The simplest scheme is a **URL prefix** per version, each with its own router:

```python
app.include_router(v1_router, prefix="/v1")
app.include_router(v2_router, prefix="/v2")
```

Additive changes (new optional fields, new endpoints) don't need a new version. Removing or renaming a field, changing a type, or tightening validation does. Announce deprecations (`@app.get(..., deprecated=True)` marks a route in /docs) and keep the old version running for an agreed period.

## Worked example: the login flow, end to end

```
client                                   Taskboard
  │ POST /token  (form: username, password)  │
  │ ───────────────────────────────────────► │  look up user, verify password hash
  │ ◄─────────────────────────────────────── │  200 {"access_token": "eyJ…", "token_type": "bearer"}
  │                                          │
  │ GET /tasks   Authorization: Bearer eyJ…  │
  │ ───────────────────────────────────────► │  verify signature + expiry → user "ada"
  │ ◄─────────────────────────────────────── │  200 [...]
```

```python title=routers/auth.py
@router.post("/token")
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], session: SessionDep):
    user = session.exec(select(User).where(User.username == form.username)).first()
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(401, "Incorrect username or password",
                            headers={"WWW-Authenticate": "Bearer"})
    return {"access_token": create_access_token(user.username), "token_type": "bearer"}
```

And the `get_current_user` dependency from step 7 changes from "look up an API key" to "decode a JWT". **No endpoint changes**, because they all depend on `CurrentUser`. That's the dependency system paying off.

> [!plain] In plain English
> At login, the server checks the password once and hands back a signed **token**. The client sends the token with every request; the server only has to check the signature, without looking up a session.

## A production checklist for Taskboard

| Concern | Taskboard's answer |
|---|---|
| secrets | `SECRET_KEY` and `DATABASE_URL` from environment via `pydantic-settings` |
| passwords | argon2 hashes via `pwdlib` |
| tokens | 15-minute JWTs, `algorithms=["HS256"]` pinned |
| brute force | `5/minute` rate limit on `/token` |
| traceability | `X-Request-ID` middleware + JSON logs |
| health | `/health` (no deps), `/ready` (DB ping) |
| serving | `uvicorn --workers N --proxy-headers`, no `--reload` |
| docs | `/docs` disabled or protected in production |

## Common mistakes

> [!mistake] Long-lived tokens with no way to revoke
> A JWT valid for 30 days that leaks is valid for 30 days. Keep access tokens short and use refresh tokens.

:::quiz
q: Why must `jwt.decode` be given `algorithms=["HS256"]` explicitly?
+ so an attacker can't choose a weaker algorithm (like `none`) via the token header
- because PyJWT can't detect the algorithm
- to make decoding faster
- it's optional; the default is HS256
why: Pinning the accepted algorithms closes algorithm-confusion attacks.
:::

:::quiz
q: A valid token lacks the required `items:write` scope. Which status should the API return?
- 401
+ 403
- 404
- 429
why: The client is authenticated (so not 401) but not authorized for this action.
:::

:::quiz
q: A client sends `If-None-Match` with the current ETag. What's the efficient response?
- 200 with the full body
+ 304 Not Modified with no body
- 204 No Content
- 412 Precondition Failed
why: 304 tells the client to reuse its cached copy, which saves bandwidth and work.
:::

:::quiz
q: Which check belongs in the **liveness** probe?
+ none beyond the process answering quickly
- a database query
- calling every upstream service
- running the test suite
why: Liveness failures trigger restarts. External checks belong in readiness, which only stops traffic.
:::

:::quiz
q: You run 4 uvicorn workers and slowapi with in-memory storage at "5/minute". How many logins per minute can one client actually get?
- exactly 5
+ up to 20, because each worker process counts separately
- unlimited
- 1
why: In-memory counters are per process. Use shared storage like Redis.
:::

:::exercise
id: fp-create-token
level: 3
title: Issue an expiring token
mode: code
lang: python
file: security.py
---
Write `create_access_token(username: str) -> str` that builds a payload with `"sub": username` and `"exp"` set to **now (UTC) + 15 minutes**, and returns `jwt.encode(payload, SECRET_KEY, algorithm="HS256")`.
---starter
from datetime import datetime, timedelta, timezone

import jwt

SECRET_KEY = "change-me"
---rule
def\s+create_access_token\(\s*username\s*:\s*str\s*\)
`def create_access_token(username: str)`
---rule
["']sub["']\s*:\s*username
`"sub": username`
---rule
["']exp["']\s*:\s*(datetime\.now\(\s*timezone\.utc\s*\)|\w+)\s*\+\s*timedelta\(\s*minutes\s*=\s*15\s*\)
`"exp"`: now + `timedelta(minutes=15)`
---rule
datetime\.now\(\s*timezone\.utc\s*\)
Use timezone-aware `datetime.now(timezone.utc)`
---rule
return\s+jwt\.encode\(\s*\w+\s*,\s*SECRET_KEY\s*,\s*algorithm\s*=\s*["']HS256["']\s*\)
`jwt.encode(payload, SECRET_KEY, algorithm="HS256")`
---solution
from datetime import datetime, timedelta, timezone

import jwt

SECRET_KEY = "change-me"


def create_access_token(username: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": username, "exp": now + timedelta(minutes=15)}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")
:::

:::exercise
id: fp-decode-token
level: 3
title: Verify a token safely
mode: code
lang: python
file: deps.py
---
Finish `get_username`: decode `token` with `jwt.decode(token, SECRET_KEY, algorithms=["HS256"])`; on `jwt.InvalidTokenError` raise **401** `"Could not validate credentials"` with header `WWW-Authenticate: Bearer`; otherwise return `payload["sub"]`.
---starter
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

SECRET_KEY = "change-me"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_username(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    ...
---rule
try\s*:\s*\n\s+payload\s*=\s*jwt\.decode\(\s*token\s*,\s*SECRET_KEY\s*,\s*algorithms\s*=\s*\[\s*["']HS256["']\s*\]\s*\)
Decode inside `try:` with `algorithms=["HS256"]`
---rule
except\s+jwt\.(InvalidTokenError|PyJWTError)
Catch `jwt.InvalidTokenError`
---rule
raise\s+HTTPException\((?=[^)]*401)(?=[^)]*Could not validate credentials)(?=[^)]*WWW-Authenticate)
401 with the message and `WWW-Authenticate`
---rule
return\s+payload\[\s*["']sub["']\s*\]
Return `payload["sub"]`
---solution
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

SECRET_KEY = "change-me"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_username(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})
    return payload["sub"]
:::

:::exercise
id: fp-scopes
level: 3
title: Require a scope
mode: code
lang: python
file: routes.py
---
Protect `DELETE /items/{item_id}` so it requires the `items:delete` scope, by declaring the parameter `user: Annotated[User, Security(get_current_user, scopes=["items:delete"])]`.
---starter
from typing import Annotated

from fastapi import FastAPI, Security

from auth import User, get_current_user

app = FastAPI()


@app.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    ITEMS.pop(item_id, None)
---rule
user\s*:\s*Annotated\[\s*User\s*,\s*Security\(\s*get_current_user\s*,\s*scopes\s*=\s*\[\s*["']items:delete["']\s*\]\s*\)\s*\]
`Security(get_current_user, scopes=["items:delete"])`
---rule
def\s+delete_item\(\s*item_id\s*:\s*int\s*,
Keep `item_id: int`
---solution
from typing import Annotated

from fastapi import FastAPI, Security

from auth import User, get_current_user

app = FastAPI()


@app.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, user: Annotated[User, Security(get_current_user, scopes=["items:delete"])]):
    ITEMS.pop(item_id, None)
:::

:::exercise
id: fp-hash
level: 2
title: Hash, then verify
mode: code
lang: python
file: passwords.py
---
Using `password_hash = PasswordHash.recommended()`, write `hash_password(plain)` returning `password_hash.hash(plain)` and `verify_password(plain, hashed)` returning `password_hash.verify(plain, hashed)`.
---starter
from pwdlib import PasswordHash
---rule
password_hash\s*=\s*PasswordHash\.recommended\(\s*\)
`PasswordHash.recommended()`
---rule
def\s+hash_password\(\s*plain[^)]*\)[^:]*:\s*\n\s+return\s+password_hash\.hash\(\s*plain\s*\)
`hash_password` returns `password_hash.hash(plain)`
---rule
def\s+verify_password\(\s*plain[^,]*,\s*hashed[^)]*\)[^:]*:\s*\n\s+return\s+password_hash\.verify\(\s*plain\s*,\s*hashed\s*\)
`verify_password` returns `password_hash.verify(plain, hashed)`
---solution
from pwdlib import PasswordHash

password_hash = PasswordHash.recommended()


def hash_password(plain: str) -> str:
    return password_hash.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return password_hash.verify(plain, hashed)
:::

:::exercise
id: fp-request-id
level: 3
title: A request-ID middleware
mode: code
lang: python
file: main.py
---
Write an HTTP middleware `add_request_id(request, call_next)` that uses the incoming `X-Request-ID` header if present, otherwise `uuid.uuid4().hex`, awaits `call_next(request)`, sets `X-Request-ID` on the response, and returns it.
---starter
import uuid

from fastapi import FastAPI, Request

app = FastAPI()
---rule
@app\.middleware\(\s*["']http["']\s*\)\s*\nasync\s+def\s+add_request_id\(\s*request(\s*:\s*Request)?\s*,\s*call_next\s*\)
`@app.middleware("http")` on `async def add_request_id(request, call_next)`
---rule
request\.headers\.get\(\s*["']X-Request-ID["']\s*\)\s*or\s+uuid\.uuid4\(\s*\)\.hex
Header or a new UUID
---rule
response\s*=\s*await\s+call_next\(\s*request\s*\)
`response = await call_next(request)`
---rule
response\.headers\[\s*["']X-Request-ID["']\s*\]\s*=
Set the response header
---rule
return\s+response
Return the response
---solution
import uuid

from fastapi import FastAPI, Request

app = FastAPI()


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response
:::

:::exercise
id: fp-etag
level: 4
title: Conditional GET
mode: code
lang: python
file: main.py
---
`GET /settings` returns `SETTINGS_JSON` (a string) with an `ETag` header equal to `ETAG`. Make it return **304** with the `ETag` header and **no body** when the request's `If-None-Match` header equals `ETAG`.
---starter
from fastapi import FastAPI, Request, Response

app = FastAPI()
SETTINGS_JSON = '{"theme": "dark"}'
ETAG = '"v42"'


@app.get("/settings")
def settings(request: Request):
    return Response(SETTINGS_JSON, media_type="application/json", headers={"ETag": ETAG})
---rule
request\.headers\.get\(\s*["'][Ii]f-[Nn]one-[Mm]atch["']\s*\)\s*==\s*ETAG|ETAG\s*==\s*request\.headers\.get\(\s*["'][Ii]f-[Nn]one-[Mm]atch["']\s*\)
Compare `If-None-Match` with `ETAG`
---rule
return\s+Response\((?=[^)]*status_code\s*=\s*304)(?=[^)]*ETag)
Return 304 with the ETag header
---rule
return\s+Response\(\s*SETTINGS_JSON
Still return the body otherwise
---solution
from fastapi import FastAPI, Request, Response

app = FastAPI()
SETTINGS_JSON = '{"theme": "dark"}'
ETAG = '"v42"'


@app.get("/settings")
def settings(request: Request):
    if request.headers.get("if-none-match") == ETAG:
        return Response(status_code=304, headers={"ETag": ETAG})
    return Response(SETTINGS_JSON, media_type="application/json", headers={"ETag": ETAG})
:::

:::exercise
id: fp-ready
level: 2
title: Liveness and readiness
mode: code
lang: python
file: main.py
---
Add `GET /health` returning `{"status": "ok"}` with **no** dependencies, and `GET /ready` that calls `db_ping()` and raises **503** `"database unavailable"` if it returns `False`, otherwise returns `{"status": "ready"}`.
---starter
from fastapi import FastAPI, HTTPException

from db import db_ping

app = FastAPI()
---rule
@app\.get\(\s*["']/health["']\s*\)\s*\n(async\s+)?def\s+\w+\(\s*\)\s*:\s*\n\s+return\s*\{\s*["']status["']\s*:\s*["']ok["']\s*\}
`/health` returns `{"status": "ok"}` immediately
---rule
@app\.get\(\s*["']/ready["']\s*\)
`GET /ready`
---rule
if\s+not\s+db_ping\(\s*\)|db_ping\(\s*\)\s+is\s+False|db_ping\(\s*\)\s*==\s*False
Check `db_ping()`
---rule
HTTPException\([^)]*503[^)]*database unavailable|HTTPException\([^)]*SERVICE_UNAVAILABLE[^)]*database unavailable
503 `"database unavailable"`
---rule
["']status["']\s*:\s*["']ready["']
Return `{"status": "ready"}`
---solution
from fastapi import FastAPI, HTTPException

from db import db_ping

app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    if not db_ping():
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "ready"}
:::

:::exercise
id: fp-uvicorn
level: 2
title: The production command
mode: code
lang: bash
file: start.sh
---
Write the `uvicorn` command that serves `main:app` on all interfaces, port `8000`, with **4 workers** and **proxy headers** enabled. No auto-reload.
---starter
#!/bin/sh
---rule
uvicorn\s+main:app
`uvicorn main:app`
---rule
--host[ =]0\.0\.0\.0
`--host 0.0.0.0`
---rule
--port[ =]8000
`--port 8000`
---rule
--workers[ =]4
`--workers 4`
---rule
--proxy-headers
`--proxy-headers`
---rule
!--reload
No `--reload`
---solution
#!/bin/sh
exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers
:::

:::exercise
id: fp-status-429
level: 1
title: Too many requests
mode: answer
---
A client exceeds the rate limit. What HTTP status code should it get?
---answer
429
---solution
429
:::

:::exercise
id: proj-fa-13-login
level: 4
title: "Project 13: the /token endpoint"
mode: code
lang: python
file: routers/auth.py
---
Write `POST /token`: take `form: Annotated[OAuth2PasswordRequestForm, Depends()]` and `session: SessionDep`; load the user with `session.exec(select(User).where(User.username == form.username)).first()`; if it's `None` or `verify_password(form.password, user.password_hash)` is false, raise **401** `"Incorrect username or password"` with header `WWW-Authenticate: Bearer`; otherwise return `{"access_token": create_access_token(user.username), "token_type": "bearer"}`.
---starter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import select

from db import SessionDep, User
from security import create_access_token, verify_password

router = APIRouter()
---rule
@router\.post\(\s*["']/token["']\s*\)
`POST /token`
---rule
form\s*:\s*Annotated\[\s*OAuth2PasswordRequestForm\s*,\s*Depends\(\s*\)\s*\]
The OAuth2 form dependency
---rule
session\.exec\(\s*select\(\s*User\s*\)\.where\(\s*User\.username\s*==\s*form\.username\s*\)\s*\)\.first\(\s*\)
Look up the user
---rule
if\s+\w+\s+is\s+None\s+or\s+not\s+verify_password\(\s*form\.password\s*,\s*\w+\.password_hash\s*\)
Check user and password together
---rule
raise\s+HTTPException\((?=[^)]*401)(?=[^)]*Incorrect username or password)(?=[^)]*WWW-Authenticate)
401 with the header
---rule
["']access_token["']\s*:\s*create_access_token\(\s*\w+\.username\s*\)
Issue the token
---rule
["']token_type["']\s*:\s*["']bearer["']
`token_type: bearer`
---solution
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import select

from db import SessionDep, User
from security import create_access_token, verify_password

router = APIRouter()


@router.post("/token")
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], session: SessionDep):
    user = session.exec(select(User).where(User.username == form.username)).first()
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect username or password", headers={"WWW-Authenticate": "Bearer"})
    return {"access_token": create_access_token(user.username), "token_type": "bearer"}
:::

:::exercise
id: proj-fa-13-settings
level: 2
title: "Project 13b: settings from the environment"
mode: code
lang: python
file: config.py
---
Write `class Settings(BaseSettings)` with `database_url: str = "sqlite:///taskboard.db"`, a required `secret_key: str`, `access_token_minutes: int = 15`, and `model_config = SettingsConfigDict(env_file=".env")`. Create `settings = Settings()`.
---starter
from pydantic_settings import BaseSettings, SettingsConfigDict
---rule
class\s+Settings\(\s*BaseSettings\s*\)\s*:
`class Settings(BaseSettings)`
---rule
database_url\s*:\s*str\s*=\s*["']sqlite:///taskboard\.db["']
`database_url` with a default
---rule
secret_key\s*:\s*str\s*$
Required `secret_key`
---rule
access_token_minutes\s*:\s*int\s*=\s*15
`access_token_minutes: int = 15`
---rule
model_config\s*=\s*SettingsConfigDict\(\s*env_file\s*=\s*["']\.env["']\s*\)
Read `.env`
---rule
settings\s*=\s*Settings\(\s*\)
`settings = Settings()`
---solution
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///taskboard.db"
    secret_key: str
    access_token_minutes: int = 15
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
:::
