---
id: fastapi-deps
title: Dependency injection & auth
summary: Depends for shared parameters, classes as dependencies, yield dependencies for setup/teardown, sub-dependencies, router-wide dependencies, API-key and bearer-token auth, and password hashing basics.
minutes: 35
---
## What a dependency is

A **dependency** is a function (or class) that FastAPI calls **before** your handler, passing its return value in. Declare it with `Depends`:

```python
from typing import Annotated
from fastapi import Depends, FastAPI

app = FastAPI()


def pagination(skip: int = 0, limit: int = 20):
    return {"skip": skip, "limit": min(limit, 100)}


@app.get("/items")
def list_items(page: Annotated[dict, Depends(pagination)]):
    return page


@app.get("/users")
def list_users(page: Annotated[dict, Depends(pagination)]):
    return page
```

The dependency's own parameters (`skip`, `limit`) become query parameters of **every route that uses it**. Write the logic once, reuse it everywhere, and it shows up correctly in /docs.

Typical uses: database sessions, the current user, permissions, pagination, settings, rate limits, feature flags.

> [!tip] Make an alias
> `Pagination = Annotated[dict, Depends(pagination)]`, then `def list_items(page: Pagination)`. Short, reusable, and type-checker friendly.

## Dependencies with setup and teardown: yield

Code before `yield` runs before the handler; code after it runs after the response is sent, even if the handler raised. This is the standard pattern for database sessions:

```python
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/orders")
def list_orders(db: Annotated[Session, Depends(get_db)]):
    return db.query(Order).all()
```

## Dependencies can depend on dependencies

```python
def get_token(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated",
                            headers={"WWW-Authenticate": "Bearer"})
    return authorization.removeprefix("Bearer ")


def get_current_user(token: Annotated[str, Depends(get_token)]) -> dict:
    user = fake_tokens.get(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user


def require_admin(user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return user
```

FastAPI resolves the whole chain, and caches each dependency once per request.

## Protecting many routes at once

```python
router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])
```

Every route in the router now requires an admin, even routes that don't use the user object. `FastAPI(dependencies=[...])` does the same app-wide.

## API keys from a header

```python
from fastapi import Header

def verify_key(x_api_key: Annotated[str, Header()]):
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
```

`Header()` reads `X-API-Key` (underscores in the parameter name become hyphens).

## OAuth2 bearer tokens, in brief

FastAPI ships helpers for the standard login flow:

```python
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


@app.post("/token")
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    user = authenticate(form.username, form.password)        # check the hashed password
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    return {"access_token": create_jwt(user), "token_type": "bearer"}


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    return decode_jwt(token)                                   # verify signature + expiry
```

`OAuth2PasswordBearer` reads `Authorization: Bearer <token>` and returns 401 automatically when it's missing; it also adds the "Authorize" button to /docs.

> [!warn] Passwords
> Never store passwords; store **hashes** made with a slow, salted algorithm (bcrypt, argon2), e.g. via `passlib` or `pwdlib`. Compare with the library's verify function. Tokens (JWTs) should be signed with a secret from configuration and carry an expiry.

## Classes as dependencies

Any callable works, including a class: `Depends(Paginator)` constructs an instance from the query parameters its `__init__` declares.

:::quiz
q: A dependency declares `skip: int = 0`. Where does `skip` come from for routes that use it?
+ the query string of the request
- the handler's arguments
- the dependency's default only
- the request body
why: Dependency parameters are resolved like path operation parameters.
:::

:::quiz
q: In a `yield` dependency, when does the code after `yield` run?
- before the handler
+ after the handler (and the response), even if the handler raised (when inside finally)
- only if the handler succeeded
- never
why: It's the teardown half: perfect for closing database sessions.
:::

:::quiz
q: `APIRouter(dependencies=[Depends(require_admin)])` means…
+ every route in that router runs require_admin first
- only GET routes are protected
- the router is hidden from /docs
- require_admin replaces the handlers
why: Router-level dependencies apply to all its routes without changing their signatures.
:::

:::quiz
q: How should user passwords be stored?
- encrypted with a key in the config
- base64-encoded
+ hashed with a slow, salted algorithm like bcrypt or argon2
- in plain text in a separate table
why: Hashes can't be reversed; slow salted hashing defeats brute force and rainbow tables.
:::

:::exercise
id: fd-depends
level: 2
title: A reusable dependency
mode: code
lang: python
file: main.py
---
Write a dependency function `common_params(q: str | None = None, limit: int = 10)` that returns `{"q": q, "limit": limit}`, and use it in `GET /articles` through `Annotated[dict, Depends(common_params)]`, returning the dict.
---starter
from typing import Annotated

from fastapi import Depends, FastAPI

app = FastAPI()
---rule
def\s+common_params\(\s*q\s*:\s*(str\s*\|\s*None|Optional\[str\])\s*=\s*None\s*,\s*limit\s*:\s*int\s*=\s*10\s*\)
`def common_params(q: str | None = None, limit: int = 10)`
---rule
return\s*\{\s*["']q["']\s*:\s*q\s*,\s*["']limit["']\s*:\s*limit\s*\}
It returns `{"q": q, "limit": limit}`
---rule
@app\.get\(\s*["']/articles["']
`GET /articles`
---rule
Annotated\[\s*dict\s*,\s*Depends\(\s*common_params\s*\)\s*\]
The route parameter uses `Annotated[dict, Depends(common_params)]`
---solution
from typing import Annotated

from fastapi import Depends, FastAPI

app = FastAPI()


def common_params(q: str | None = None, limit: int = 10):
    return {"q": q, "limit": limit}


@app.get("/articles")
def list_articles(params: Annotated[dict, Depends(common_params)]):
    return params
:::

:::exercise
id: fd-yield
level: 3
title: Session per request
mode: code
lang: python
file: deps.py
---
Write the `yield` dependency `get_db()`: create `db = SessionLocal()`, `yield` it inside `try`, and close it in `finally`.
---starter
from database import SessionLocal
---rule
def\s+get_db\(\s*\)\s*:
`def get_db():`
---rule
db\s*=\s*SessionLocal\(\s*\)
Create the session
---rule
try\s*:\s*\n\s*yield\s+db
`yield db` inside `try:`
---rule
finally\s*:\s*\n\s*db\.close\(\s*\)
Close it in `finally:`
---solution
from database import SessionLocal


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
:::

:::exercise
id: fd-api-key
level: 3
title: API-key protection
mode: code
lang: python
file: main.py
---
Write a dependency `verify_api_key` that reads the `X-API-Key` header (parameter `x_api_key: Annotated[str, Header()]`) and raises **401** `"Invalid API key"` unless it equals `API_KEY`. Protect `GET /reports` with it using `dependencies=[Depends(verify_api_key)]` in the decorator.
---starter
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException

app = FastAPI()
API_KEY = "s3cr3t"
---rule
def\s+verify_api_key\(\s*x_api_key\s*:\s*Annotated\[\s*str\s*,\s*Header\(\s*\)\s*\]\s*\)
`def verify_api_key(x_api_key: Annotated[str, Header()])`
---rule
if\s+x_api_key\s*!=\s*API_KEY\s*:
Compare with `API_KEY`
---rule
raise\s+HTTPException\([^)]*401[^)]*["']Invalid API key["']
Raise 401 `"Invalid API key"`
---rule
@app\.get\(\s*["']/reports["'][^)]*dependencies\s*=\s*\[\s*Depends\(\s*verify_api_key\s*\)\s*\]
`@app.get("/reports", dependencies=[Depends(verify_api_key)])`
---solution
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException

app = FastAPI()
API_KEY = "s3cr3t"


def verify_api_key(x_api_key: Annotated[str, Header()]):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/reports", dependencies=[Depends(verify_api_key)])
def reports():
    return {"reports": []}
:::

:::exercise
id: fd-current-user
level: 3
title: Current user, then admin
mode: code
lang: python
file: deps.py
---
Given `get_current_user` (already written), add `require_admin(user: Annotated[dict, Depends(get_current_user)])` that raises **403** `"Admins only"` unless `user["role"] == "admin"`, and returns the user. Then create `admin_router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])`.
---starter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException


def get_current_user() -> dict:
    return {"name": "ada", "role": "user"}
---rule
def\s+require_admin\(\s*user\s*:\s*Annotated\[\s*dict\s*,\s*Depends\(\s*get_current_user\s*\)\s*\]\s*\)
`require_admin` depends on `get_current_user`
---rule
if\s+user\[\s*["']role["']\s*\]\s*!=\s*["']admin["']\s*:
Check the role
---rule
raise\s+HTTPException\([^)]*403[^)]*["']Admins only["']
Raise 403 `"Admins only"`
---rule
return\s+user
Return the user
---rule
admin_router\s*=\s*APIRouter\((?=[^)]*prefix\s*=\s*["']/admin["'])(?=[^)]*dependencies\s*=\s*\[\s*Depends\(\s*require_admin\s*\)\s*\])
`APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])`
---solution
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException


def get_current_user() -> dict:
    return {"name": "ada", "role": "user"}


def require_admin(user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return user


admin_router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])
:::

:::exercise
id: fd-oauth
level: 3
title: Bearer token scheme
mode: code
lang: python
file: auth.py
---
Create `oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")` and a dependency `get_current_user(token: Annotated[str, Depends(oauth2_scheme)])` that looks the token up in `TOKENS` and raises **401** `"Invalid token"` (with `WWW-Authenticate: Bearer`) if it's unknown, otherwise returns the username.
---starter
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

TOKENS = {"abc123": "ada"}
---rule
oauth2_scheme\s*=\s*OAuth2PasswordBearer\(\s*tokenUrl\s*=\s*["']token["']\s*\)
`OAuth2PasswordBearer(tokenUrl="token")`
---rule
def\s+get_current_user\(\s*token\s*:\s*Annotated\[\s*str\s*,\s*Depends\(\s*oauth2_scheme\s*\)\s*\]\s*\)
`get_current_user(token: Annotated[str, Depends(oauth2_scheme)])`
---rule
TOKENS\.get\(\s*token\s*\)|token\s+not\s+in\s+TOKENS|token\s+in\s+TOKENS
Look the token up in `TOKENS`
---rule
raise\s+HTTPException\((?=[^)]*401)(?=[^)]*["']Invalid token["'])(?=[^)]*WWW-Authenticate)
401 `"Invalid token"` with the `WWW-Authenticate` header
---solution
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

TOKENS = {"abc123": "ada"}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    user = TOKENS.get(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token", headers={"WWW-Authenticate": "Bearer"})
    return user
:::

:::exercise
id: fd-predict-query
level: 2
title: Predict: dependency parameters
mode: answer
---
```python
def paging(page: int = 1, size: int = 10):
    return {"offset": (page - 1) * size, "size": size}

@app.get("/logs")
def logs(p: Annotated[dict, Depends(paging)]):
    return p
```

What does `GET /logs?page=3&size=25` return?
---answer
{"offset": 50, "size": 25}
---solution
{"offset": 50, "size": 25}
:::

:::exercise
id: fd-predict-chain
level: 3
title: Predict: which check fails first?
mode: answer
---
Using the `get_token → get_current_user → require_admin` chain from the lesson, a request to an admin route arrives **with no Authorization header**. What status code comes back?
---answer
401
---solution
401
---explain
`get_token` runs first and rejects the missing header before the role is ever checked.
:::

:::exercise
id: fd-predict-header-name
level: 2
title: Predict: header naming
mode: answer
---
A dependency parameter is declared as `user_agent: Annotated[str, Header()]`. Which HTTP header does it read?
---answer
User-Agent
---solution
User-Agent
:::
