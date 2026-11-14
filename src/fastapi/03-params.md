---
id: fastapi-params
title: Path & query parameters
summary: Typed path parameters and automatic conversion, query parameters with defaults and optional values, validation with Path and Query, enums, list parameters, and route ordering.
minutes: 35
---
> [!project] Taskboard, step 3: finding tasks
> A board with 500 tasks needs filtering. This step adds `GET /tasks/{task_id}` and query parameters to filter by status and limit the result, with validation so bad input gets a clear 422 instead of a crash.

## Path parameters

Curly braces in the path declare a **path parameter**; a function argument with the same name receives it. The type hint drives conversion and validation:

```python
@app.get("/items/{item_id}")
def read_item(item_id: int):
    return {"item_id": item_id}
```

| Request | Response |
|---|---|
| `GET /items/42` | `200 {"item_id": 42}` (an **int**, not `"42"`) |
| `GET /items/abc` | `422` with a validation error explaining `item_id` must be an integer |
| `GET /items` | `404 {"detail": "Not Found"}` (no route matches) |

The 422 body looks like this (Pydantic v2):

```json
{"detail": [{"type": "int_parsing", "loc": ["path", "item_id"],
             "msg": "Input should be a valid integer, unable to parse string as an integer",
             "input": "abc"}]}
```

`loc` tells the client exactly which input failed and where it came from (`path`, `query`, `body`, `header`).

## Query parameters

Simple scalar function arguments that are **not** in the path are normally **query parameters**. Pydantic models and explicitly declared headers, cookies, bodies and dependencies have their own sources:

```python
@app.get("/items")
def list_items(skip: int = 0, limit: int = 10, q: str | None = None):
    return {"skip": skip, "limit": limit, "q": q}
```

| Request | Result |
|---|---|
| `GET /items` | `{"skip": 0, "limit": 10, "q": null}` |
| `GET /items?limit=5&q=bolt` | `{"skip": 0, "limit": 5, "q": "bolt"}` |
| `GET /items?limit=many` | 422 |

The rules:

- has a default → **optional**
- default `None` with type `X | None` → optional and may be absent
- **no default → required**: missing it gives 422 with `"type": "missing"`

`bool` query parameters accept `true/false`, `1/0`, `yes/no`, `on/off`.

## Validation with Query and Path

`Query()` and `Path()` add constraints (and documentation) on top of the type. The modern style uses `Annotated`:

```python
from typing import Annotated
from fastapi import FastAPI, Path, Query

@app.get("/items/{item_id}")
def read_item(
    item_id: Annotated[int, Path(ge=1)],
    q: Annotated[str | None, Query(min_length=3, max_length=50)] = None,
    limit: Annotated[int, Query(gt=0, le=100)] = 10,
):
    ...
```

| Constraint | Meaning |
|---|---|
| `gt`, `ge`, `lt`, `le` | numeric bounds (greater than, greater or equal…) |
| `min_length`, `max_length` | string length |
| `pattern="^[a-z]+$"` | regex the string must match |
| `alias="item-query"` | the name used in the URL |
| `description="..."` | shows up in /docs |

For example, `/items?limit=1000` fails validation with the `le=100` constraint above. Bounding page sizes prevents a single request from fetching an excessive number of records.

## Enums for fixed choices

```python
from enum import Enum

class Size(str, Enum):
    small = "small"
    medium = "medium"
    large = "large"

@app.get("/shirts/{size}")
def shirts(size: Size):
    return {"size": size, "price": 20 if size is Size.small else 25}
```

`GET /shirts/huge` → 422 listing the allowed values, and `/docs` shows a dropdown.

## Lists in the query string

```python
@app.get("/search")
def search(tag: Annotated[list[str], Query()] = []):
    return {"tags": tag}
```

`GET /search?tag=red&tag=blue` → `{"tags": ["red", "blue"]}`. Lists need `Query()`, otherwise FastAPI would expect them in the body.

## Route order matters

Routes are matched **top to bottom**:

```python
@app.get("/users/me")          # must come first
def read_me(): ...

@app.get("/users/{user_id}")
def read_user(user_id: int): ...
```

If `/users/{user_id}` were declared first, `GET /users/me` would match it and fail with 422 because `"me"` isn't an int.

## Worked example: how FastAPI reads a request

Given this function:

```python
@app.get("/tasks/{task_id}")
def get_task(task_id: int, verbose: bool = False):
    ...
```

and the request `GET /tasks/7?verbose=true`, FastAPI:

1. matches the path template and pulls `"7"` out of the URL;
2. sees `task_id: int`, converts `"7"` → `7` (or answers **422** if it can't, e.g. `/tasks/abc`);
3. sees `verbose` isn't in the path, so it's a **query parameter**; `"true"` → `True`;
4. calls your function with clean Python values.

The **type hints are the specification**. Change `task_id: int` to `task_id: str` and the behaviour changes, with no other code.

## Worked example: an Enum for allowed values

Free text for `status` invites typos (`"Done"`, `"finished"`). An Enum makes the allowed values explicit, validates them, and shows a dropdown in `/docs`:

```python
from enum import Enum

class Status(str, Enum):
    todo = "todo"
    doing = "doing"
    done = "done"

@app.get("/tasks")
def list_tasks(status: Status | None = None, limit: int = 20):
    result = [t for t in TASKS if status is None or t["status"] == status]
    return result[:limit]
```

Inheriting from `str` means `Status.done == "done"` is `True`, so comparisons with plain strings and JSON output both just work.

> [!plain] In plain English
> Path parameters identify **which** thing (`/tasks/7`). Query parameters adjust **how** you get things (`?status=done&limit=5`). A parameter with a default is optional.

## Common mistakes

> [!mistake] Route order: `/tasks/stats` vs `/tasks/{task_id}`
> Routes are matched top to bottom. If `/tasks/{task_id}` is declared first, `GET /tasks/stats` tries to convert `"stats"` to an int and returns 422. Declare fixed paths before parameterized ones.

:::quiz
q: `def f(item_id: int)` on route `/items/{item_id}`. What does `GET /items/007` give `item_id`?
+ the integer 7
- the string "007"
- a 422 error
- the integer 007 as octal
why: The path segment is parsed and validated as an int.
:::

:::quiz
q: `def search(q: str)` with no default, on `GET /search`. What does `GET /search` return?
- 200 with q = ""
- 200 with q = None
+ 422, because q is a required query parameter
- 404
why: No default means required.
:::

:::quiz
q: Which declares an optional query parameter `q` that may be omitted?
- `q: str`
+ `q: str | None = None`
- `q: Optional`
- `q = Query(...)`
why: A default value makes it optional; None is the conventional "absent" value.
:::

:::quiz
q: `/users/{user_id}` is declared before `/users/me`. What happens for `GET /users/me` if user_id is an int?
- /users/me is called
+ 422, because "me" can't be parsed as an int
- 404
- FastAPI picks the most specific route automatically
why: The first matching route wins, so declare fixed paths before parameterized ones.
:::

:::exercise
id: fp-path
level: 1
title: Typed path parameter
mode: code
lang: python
file: main.py
---
Add `GET /users/{user_id}` where `user_id` is an **int**, returning `{"user_id": user_id}`.
---starter
from fastapi import FastAPI

app = FastAPI()
---rule
@app\.get\(\s*["']/users/\{user_id\}["']
A route `"/users/{user_id}"`
---rule
def\s+\w+\(\s*user_id\s*:\s*int\b
The handler takes `user_id: int`
---rule
return\s*\{\s*["']user_id["']\s*:\s*user_id\s*\}
It returns `{"user_id": user_id}`
---solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/users/{user_id}")
def read_user(user_id: int):
    return {"user_id": user_id}
:::

:::exercise
id: fp-query-defaults
level: 1
title: Paging parameters
mode: code
lang: python
file: main.py
---
Add `GET /products` with two **int** query parameters, `skip` defaulting to `0` and `limit` defaulting to `20`, returning `{"skip": skip, "limit": limit}`.
---starter
from fastapi import FastAPI

app = FastAPI()
---rule
@app\.get\(\s*["']/products["']
A `GET /products` route
---rule
skip\s*:\s*int\s*=\s*0
`skip: int = 0`
---rule
limit\s*:\s*int\s*=\s*20
`limit: int = 20`
---rule
return\s*\{[^}]*["']skip["']\s*:\s*skip[^}]*["']limit["']\s*:\s*limit[^}]*\}|return\s*\{[^}]*["']limit["']\s*:\s*limit[^}]*["']skip["']\s*:\s*skip[^}]*\}
Return both values
---solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/products")
def list_products(skip: int = 0, limit: int = 20):
    return {"skip": skip, "limit": limit}
:::

:::exercise
id: fp-optional
level: 2
title: An optional search term
mode: code
lang: python
file: main.py
---
Add `GET /search` with an **optional** string query parameter `q` (default `None`) and a **required** int query parameter `page`. Return `{"q": q, "page": page}`.
---starter
from fastapi import FastAPI

app = FastAPI()
---rule
@app\.get\(\s*["']/search["']
A `GET /search` route
---rule
\bq\s*:\s*(str\s*\|\s*None|Optional\[str\]|None\s*\|\s*str)\s*=\s*None
`q` is optional: `q: str | None = None`
---rule
\bpage\s*:\s*int\s*[,)]
`page: int` with **no** default (required)
---rule
return\s*\{[^}]*["']q["']\s*:\s*q\b[^}]*\}
Return `q` and `page`
---solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/search")
def search(page: int, q: str | None = None):
    return {"q": q, "page": page}
:::

:::exercise
id: fp-validate
level: 3
title: Constrain the input
mode: code
lang: python
file: main.py
---
Add `GET /items/{item_id}` where `item_id` must be an int **≥ 1** (use `Path`), and a query parameter `limit` that's an int **between 1 and 100 inclusive** defaulting to `10` (use `Query`). Return `{"item_id": item_id, "limit": limit}`. Use `Annotated`.
---starter
from typing import Annotated

from fastapi import FastAPI, Path, Query

app = FastAPI()
---rule
@app\.get\(\s*["']/items/\{item_id\}["']
Route `"/items/{item_id}"`
---rule
item_id\s*:\s*Annotated\[\s*int\s*,\s*Path\([^)]*ge\s*=\s*1
`item_id: Annotated[int, Path(ge=1)]`
---rule
limit\s*:\s*Annotated\[\s*int\s*,\s*Query\((?=[^)]*ge\s*=\s*1)(?=[^)]*le\s*=\s*100)[^)]*\)\s*\]\s*=\s*10
`limit: Annotated[int, Query(ge=1, le=100)] = 10`
---rule
return\s*\{[^}]*["']item_id["']\s*:\s*item_id
Return the values
---solution
from typing import Annotated

from fastapi import FastAPI, Path, Query

app = FastAPI()


@app.get("/items/{item_id}")
def read_item(
    item_id: Annotated[int, Path(ge=1)],
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
):
    return {"item_id": item_id, "limit": limit}
:::

:::exercise
id: fp-enum
level: 3
title: Only these values
mode: code
lang: python
file: main.py
---
Create a string enum `Sort` with members `price` and `rating` (values `"price"` and `"rating"`), and a route `GET /catalog` with a query parameter `sort: Sort` defaulting to `Sort.price`, returning `{"sort": sort}`.
---starter
from enum import Enum

from fastapi import FastAPI

app = FastAPI()
---rule
class\s+Sort\s*\(\s*str\s*,\s*Enum\s*\)\s*:
`class Sort(str, Enum):`
---rule
^\s+price\s*=\s*["']price["']
member `price = "price"`
---rule
^\s+rating\s*=\s*["']rating["']
member `rating = "rating"`
---rule
sort\s*:\s*Sort\s*=\s*Sort\.price
`sort: Sort = Sort.price`
---rule
@app\.get\(\s*["']/catalog["']
`GET /catalog`
---solution
from enum import Enum

from fastapi import FastAPI

app = FastAPI()


class Sort(str, Enum):
    price = "price"
    rating = "rating"


@app.get("/catalog")
def catalog(sort: Sort = Sort.price):
    return {"sort": sort}
:::

:::exercise
id: fp-route-order
level: 3
title: Fix the route order
mode: code
lang: python
file: main.py
---
`GET /users/me` returns 422 in this app. Reorder the code so `/users/me` works (keep both routes).
---starter
from fastapi import FastAPI

app = FastAPI()


@app.get("/users/{user_id}")
def read_user(user_id: int):
    return {"user_id": user_id}


@app.get("/users/me")
def read_me():
    return {"user_id": "the current user"}
---rule
@app\.get\(\s*["']/users/me["'][\s\S]*@app\.get\(\s*["']/users/\{user_id\}["']
`/users/me` is declared **before** `/users/{user_id}`
---rule
def\s+read_user\(\s*user_id\s*:\s*int\s*\)
`read_user(user_id: int)` is still there
---solution
from fastapi import FastAPI

app = FastAPI()


@app.get("/users/me")
def read_me():
    return {"user_id": "the current user"}


@app.get("/users/{user_id}")
def read_user(user_id: int):
    return {"user_id": user_id}
:::

:::exercise
id: fp-list-query
level: 3
title: Many tags
mode: code
lang: python
file: main.py
---
Add `GET /posts` accepting a repeatable query parameter `tag` (a list of strings, default empty list) so that `/posts?tag=a&tag=b` returns `{"tags": ["a", "b"]}`.
---starter
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()
---rule
@app\.get\(\s*["']/posts["']
`GET /posts`
---rule
tag\s*:\s*Annotated\[\s*list\[\s*str\s*\]\s*,\s*Query\([^)]*\)\s*\]\s*=\s*\[\s*\]|tag\s*:\s*list\[\s*str\s*\]\s*=\s*Query\(
`tag` is declared as a `list[str]` with `Query()`
---rule
return\s*\{\s*["']tags["']\s*:\s*tag\s*\}
Return `{"tags": tag}`
---solution
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()


@app.get("/posts")
def posts(tag: Annotated[list[str], Query()] = []):
    return {"tags": tag}
:::

:::exercise
id: fp-predict-int
level: 2
title: Predict: conversion
mode: answer
---
```python
@app.get("/double/{n}")
def double(n: int):
    return {"result": n * 2}
```

What JSON does `GET /double/21` return?
---answer
{"result": 42}
---solution
{"result": 42}
:::

:::exercise
id: fp-predict-422
level: 2
title: Predict: bad type
mode: answer
---
Same route as above. What **status code** does `GET /double/twenty` return?
---answer
422
---solution
422
:::

:::exercise
id: fp-predict-default
level: 2
title: Predict: defaults
mode: answer
---
```python
@app.get("/greet")
def greet(name: str = "stranger", excited: bool = False):
    return {"msg": f"Hello, {name}{'!' if excited else '.'}"}
```

What does `GET /greet?excited=yes` return?
---answer
{"msg": "Hello, stranger!"}
---solution
{"msg": "Hello, stranger!"}
:::

:::exercise
id: fp-predict-missing
level: 3
title: Predict: the error location
mode: answer
---
```python
@app.get("/convert")
def convert(amount: float, currency: str):
    ...
```

A client calls `GET /convert?amount=10`. The 422 error's `loc` is a list of two strings. Write it as JSON.
---answer
["query", "currency"]
---solution
["query", "currency"]
:::

:::exercise
id: fp-predict-loc-path
level: 3
title: Predict: path vs query
mode: answer
---
```python
@app.get("/teams/{team_id}/players")
def players(team_id: int, limit: int = 10):
    ...
```

Which is the `loc` of the error for `GET /teams/x/players?limit=5`? Write it as JSON.
---answer
["path", "team_id"]
---solution
["path", "team_id"]
:::

:::exercise
id: proj-fa-03-filter
level: 2
title: "Project 3: filter the board"
mode: code
lang: python
file: main.py
---
Define `class Status(str, Enum)` with members `todo`, `doing`, `done`. Change `GET /tasks` to accept an optional `status: Status | None = None` and `limit: Annotated[int, Query(ge=1, le=100)] = 20`, returning the matching tasks (all when `status` is None), at most `limit` of them.
---starter
from enum import Enum
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI(title="Taskboard", version="0.1.0")

TASKS = [
    {"id": 1, "title": "Set up repo", "status": "done"},
    {"id": 2, "title": "Write API", "status": "doing"},
    {"id": 3, "title": "Add tests", "status": "todo"},
]


@app.get("/tasks")
def list_tasks():
    return TASKS
---rule
class\s+Status\(\s*str\s*,\s*Enum\s*\)\s*:
`class Status(str, Enum)`
---rule
todo\s*=\s*["']todo["'][\s\S]*doing\s*=\s*["']doing["'][\s\S]*done\s*=\s*["']done["']
Members `todo`, `doing`, `done`
---rule
status\s*:\s*(Status\s*\|\s*None|Optional\[\s*Status\s*\])\s*=\s*None
`status: Status | None = None`
---rule
limit\s*:\s*Annotated\[\s*int\s*,\s*Query\((?=[^)]*ge\s*=\s*1)(?=[^)]*le\s*=\s*100)[^)]*\)\s*\]\s*=\s*20
`limit: Annotated[int, Query(ge=1, le=100)] = 20`
---rule
status\s+is\s+None\s+or\s+\w+\[\s*["']status["']\s*\]\s*==\s*status|\w+\[\s*["']status["']\s*\]\s*==\s*status\s+or\s+status\s+is\s+None|if\s+status(\s+is\s+not\s+None)?\s*:
Filter by status only when given
---rule
\[\s*:\s*limit\s*\]
Apply the limit
---solution
from enum import Enum
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI(title="Taskboard", version="0.1.0")


class Status(str, Enum):
    todo = "todo"
    doing = "doing"
    done = "done"


TASKS = [
    {"id": 1, "title": "Set up repo", "status": "done"},
    {"id": 2, "title": "Write API", "status": "doing"},
    {"id": 3, "title": "Add tests", "status": "todo"},
]


@app.get("/tasks")
def list_tasks(status: Status | None = None, limit: Annotated[int, Query(ge=1, le=100)] = 20):
    result = [t for t in TASKS if status is None or t["status"] == status]
    return result[:limit]
:::

:::exercise
id: proj-fa-03-one
level: 2
title: "Project 3b: one task by id"
mode: code
lang: python
file: main.py
---
Add `GET /tasks/{task_id}` with `task_id: Annotated[int, Path(ge=1)]` that returns the matching task dict, or `{"detail": "not found"}` if none matches (proper 404s come in lesson 5).
---starter
from typing import Annotated

from fastapi import FastAPI, Path

app = FastAPI(title="Taskboard", version="0.1.0")

TASKS = [
    {"id": 1, "title": "Set up repo", "status": "done"},
    {"id": 2, "title": "Write API", "status": "doing"},
]
---rule
@app\.get\(\s*["']/tasks/\{task_id\}["']\s*\)
`GET /tasks/{task_id}`
---rule
task_id\s*:\s*Annotated\[\s*int\s*,\s*Path\(\s*ge\s*=\s*1\s*\)\s*\]
`task_id: Annotated[int, Path(ge=1)]`
---rule
for\s+(\w+)\s+in\s+TASKS\s*:\s*\n\s+if\s+\1\[\s*["']id["']\s*\]\s*==\s*task_id\s*:\s*\n\s+return\s+\1|next\(\s*\(?\s*(\w+)\s+for\s+\2\s+in\s+TASKS\s+if\s+\2\[\s*["']id["']\s*\]\s*==\s*task_id
Find the task by id
---rule
return\s*\{\s*["']detail["']\s*:\s*["']not found["']\s*\}|None\s*\)?\s*or\s*\{\s*["']detail["']\s*:\s*["']not found["']\s*\}
Fallback `{"detail": "not found"}`
---solution
from typing import Annotated

from fastapi import FastAPI, Path

app = FastAPI(title="Taskboard", version="0.1.0")

TASKS = [
    {"id": 1, "title": "Set up repo", "status": "done"},
    {"id": 2, "title": "Write API", "status": "doing"},
]


@app.get("/tasks/{task_id}")
def get_task(task_id: Annotated[int, Path(ge=1)]):
    for task in TASKS:
        if task["id"] == task_id:
            return task
    return {"detail": "not found"}
:::
