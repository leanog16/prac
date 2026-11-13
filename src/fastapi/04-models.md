---
id: fastapi-models
title: Request bodies & Pydantic models
summary: Declaring JSON bodies with Pydantic models, Field constraints, optional and default fields, nested models, response_model to shape and filter output, and separate input/output schemas.
minutes: 35
---
## A model is a schema

Subclass `BaseModel` and annotate fields. A parameter typed as a model is read from the **JSON body**:

```python
from pydantic import BaseModel

class ItemCreate(BaseModel):
    name: str
    price: float
    in_stock: bool = True
    tags: list[str] = []
    description: str | None = None


@app.post("/items", status_code=201)
def create_item(item: ItemCreate):
    return item
```

FastAPI will:

1. read the body as JSON,
2. validate it against the model (types, required fields, constraints),
3. give your function a typed `ItemCreate` object (`item.name`, `item.price`),
4. on failure, respond **422** with errors pointing at `["body", "price"]` etc.

| Field declaration | Meaning |
|---|---|
| `name: str` | required |
| `in_stock: bool = True` | optional with default |
| `description: str \| None = None` | optional, may be null |
| `tags: list[str] = []` | list (Pydantic copies mutable defaults safely) |

Pydantic converts compatible input in its default ("lax") mode: `"9.99"` becomes `9.99` for a `float`, `"true"` becomes `True` for a `bool`. Incompatible input (`"cheap"` for a float) fails.

## Field constraints

```python
from pydantic import BaseModel, Field, EmailStr

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-z0-9_]+$")
    email: EmailStr                       # needs the email-validator package
    age: int = Field(ge=13, le=120)
    password: str = Field(min_length=8)
```

## Nested models

```python
class Address(BaseModel):
    street: str
    city: str
    zip: str

class Customer(BaseModel):
    name: str
    address: Address              # nested object
    phones: list[str] = []
```

The body is then `{"name": "...", "address": {"street": "...", "city": "...", "zip": "..."}}`.

## Shaping the output: response_model

Declaring the **response model** (via `response_model=` or the return annotation) does two things: documents the output in /docs and **filters** whatever you return down to the model's fields. That's how you avoid leaking data:

```python
class UserOut(BaseModel):
    id: int
    username: str
    email: str


@app.post("/users", response_model=UserOut, status_code=201)
def create_user(user: UserCreate):
    saved = {"id": 1, **user.model_dump()}   # contains the password!
    return saved                              # but only id, username, email are sent
```

> [!exam] Separate input and output models
> The classic pattern is `XCreate` (what clients send), `XUpdate` (all fields optional, for PATCH) and `XOut`/`XRead` (what clients get back, with `id` and without secrets).

## Useful model methods

| Method | Does |
|---|---|
| `item.model_dump()` | → dict |
| `item.model_dump(exclude_unset=True)` | only fields the client actually sent (perfect for PATCH) |
| `item.model_dump_json()` | → JSON string |
| `Item.model_validate(data)` | build and validate from a dict |
| `item.model_copy(update={...})` | copy with changes |

## Body + path + query together

FastAPI figures out where each parameter comes from:

```python
@app.put("/items/{item_id}")
def update_item(item_id: int, item: ItemCreate, notify: bool = False):
    ...
```

- `item_id` appears in the path → **path**
- `item` is a Pydantic model → **body**
- `notify` is a simple type not in the path → **query**

:::quiz
q: A route parameter typed with a Pydantic model is read from…
- the query string
- the path
+ the JSON request body
- a header
why: Models (and other complex types) are body parameters by default.
:::

:::quiz
q: The model has `price: float`. The client sends `"price": "abc"`. The response is…
- 200 with price 0
- 400
+ 422 with loc ["body", "price"]
- 500
why: Validation errors on the body are 422 and point at the failing field.
:::

:::quiz
q: What's the main point of a separate `UserOut` response model?
+ To control exactly which fields are returned (e.g. never the password)
- To make requests faster
- It's required for POST routes
- To validate the request body
why: response_model filters the returned data to the declared fields.
:::

:::quiz
q: For a PATCH endpoint, which call gives only the fields the client sent?
- model_dump()
+ model_dump(exclude_unset=True)
- model_dump_json()
- dict(model)
why: exclude_unset drops fields that kept their default because the client didn't send them.
:::

:::exercise
id: fm-model
level: 1
title: Define a model
mode: code
lang: python
file: main.py
---
Define a Pydantic model `Book` with fields `title: str`, `author: str`, `pages: int`, and an optional `isbn` (string or `None`, default `None`).
---starter
from pydantic import BaseModel
---rule
class\s+Book\s*\(\s*BaseModel\s*\)\s*:
`class Book(BaseModel):`
---rule
^\s+title\s*:\s*str\s*$
`title: str`
---rule
^\s+author\s*:\s*str\s*$
`author: str`
---rule
^\s+pages\s*:\s*int\s*$
`pages: int`
---rule
^\s+isbn\s*:\s*(str\s*\|\s*None|Optional\[str\])\s*=\s*None
`isbn: str | None = None`
---solution
from pydantic import BaseModel


class Book(BaseModel):
    title: str
    author: str
    pages: int
    isbn: str | None = None
:::

:::exercise
id: fm-post-body
level: 2
title: Accept a body
mode: code
lang: python
file: main.py
---
Add `POST /books` with status **201** that accepts a `Book` body named `book` and returns it.
---starter
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Book(BaseModel):
    title: str
    author: str
    pages: int
---rule
@app\.post\(\s*["']/books["'][^)]*status_code\s*=\s*(201|status\.HTTP_201_CREATED)
`@app.post("/books", status_code=201)`
---rule
def\s+\w+\(\s*book\s*:\s*Book\s*\)
The handler takes `book: Book`
---rule
return\s+book\b
It returns the book
---solution
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Book(BaseModel):
    title: str
    author: str
    pages: int


@app.post("/books", status_code=201)
def create_book(book: Book):
    return book
:::

:::exercise
id: fm-constraints
level: 2
title: Add constraints
mode: code
lang: python
file: models.py
---
Write a model `SignupRequest` with `username: str` of length 3 to 20, `age: int` that must be at least 13, and `password: str` of at least 8 characters, all using `Field(...)`.
---starter
from pydantic import BaseModel, Field
---rule
class\s+SignupRequest\s*\(\s*BaseModel\s*\)
`class SignupRequest(BaseModel):`
---rule
username\s*:\s*str\s*=\s*Field\((?=[^)]*min_length\s*=\s*3)(?=[^)]*max_length\s*=\s*20)
`username` with `min_length=3` and `max_length=20`
---rule
age\s*:\s*int\s*=\s*Field\([^)]*ge\s*=\s*13
`age` with `ge=13`
---rule
password\s*:\s*str\s*=\s*Field\([^)]*min_length\s*=\s*8
`password` with `min_length=8`
---solution
from pydantic import BaseModel, Field


class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=20)
    age: int = Field(ge=13)
    password: str = Field(min_length=8)
:::

:::exercise
id: fm-response-model
level: 3
title: Never return the password
mode: code
lang: python
file: main.py
---
`create_user` returns a dict that includes the password. Define `UserOut` (fields `id: int`, `username: str`) and use it as the route's `response_model` so the password is never sent.
---starter
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class UserCreate(BaseModel):
    username: str
    password: str


@app.post("/users", status_code=201)
def create_user(user: UserCreate):
    return {"id": 1, **user.model_dump()}
---rule
class\s+UserOut\s*\(\s*BaseModel\s*\)\s*:[\s\S]*?\bid\s*:\s*int[\s\S]*?username\s*:\s*str
`class UserOut(BaseModel)` with `id: int` and `username: str`
---rule
!class\s+UserOut[^:]*:\s*\n(?:\s+\w+\s*:[^\n]*\n)*?\s+password\s*:
`UserOut` must **not** have a `password` field
---rule
@app\.post\([^)]*response_model\s*=\s*UserOut|def\s+create_user\([^)]*\)\s*->\s*UserOut
The route declares `response_model=UserOut` (or returns `-> UserOut`)
---solution
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class UserCreate(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str


@app.post("/users", response_model=UserOut, status_code=201)
def create_user(user: UserCreate):
    return {"id": 1, **user.model_dump()}
:::

:::exercise
id: fm-nested
level: 3
title: Nested models
mode: code
lang: python
file: models.py
---
Define `LineItem` (`sku: str`, `quantity: int` that must be ≥ 1 via `Field`) and `Order` (`customer_id: int`, `items: list[LineItem]`, `note: str | None = None`).
---starter
from pydantic import BaseModel, Field
---rule
class\s+LineItem\s*\(\s*BaseModel\s*\)
`class LineItem(BaseModel)`
---rule
quantity\s*:\s*int\s*=\s*Field\([^)]*ge\s*=\s*1
`quantity: int = Field(ge=1)`
---rule
class\s+Order\s*\(\s*BaseModel\s*\)
`class Order(BaseModel)`
---rule
items\s*:\s*(list|List)\[\s*LineItem\s*\]
`items: list[LineItem]`
---rule
note\s*:\s*(str\s*\|\s*None|Optional\[str\])\s*=\s*None
`note: str | None = None`
---solution
from pydantic import BaseModel, Field


class LineItem(BaseModel):
    sku: str
    quantity: int = Field(ge=1)


class Order(BaseModel):
    customer_id: int
    items: list[LineItem]
    note: str | None = None
:::

:::exercise
id: fm-patch
level: 4
title: A real PATCH
mode: code
lang: python
file: main.py
---
Implement `PATCH /items/{item_id}` that applies only the fields the client sent: define `ItemUpdate` with **all-optional** `name: str | None = None` and `price: float | None = None`, read the stored item from `items[item_id]`, update it with `update.model_dump(exclude_unset=True)`, store it back and return it.
---starter
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

items = {1: {"name": "Widget", "price": 9.99}}
---rule
class\s+ItemUpdate\s*\(\s*BaseModel\s*\)
`class ItemUpdate(BaseModel)`
---rule
name\s*:\s*(str\s*\|\s*None|Optional\[str\])\s*=\s*None
`name: str | None = None`
---rule
price\s*:\s*(float\s*\|\s*None|Optional\[float\])\s*=\s*None
`price: float | None = None`
---rule
@app\.patch\(\s*["']/items/\{item_id\}["']
`@app.patch("/items/{item_id}")`
---rule
model_dump\(\s*exclude_unset\s*=\s*True\s*\)
Use `model_dump(exclude_unset=True)`
---rule
items\[\s*item_id\s*\]\s*=|items\[\s*item_id\s*\]\.update\(
Store the updated item back in `items[item_id]`
---solution
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

items = {1: {"name": "Widget", "price": 9.99}}


class ItemUpdate(BaseModel):
    name: str | None = None
    price: float | None = None


@app.patch("/items/{item_id}")
def update_item(item_id: int, update: ItemUpdate):
    stored = items[item_id]
    stored.update(update.model_dump(exclude_unset=True))
    items[item_id] = stored
    return stored
:::

:::exercise
id: fm-predict-filter
level: 2
title: Predict: response filtering
mode: answer
---
```python
class Out(BaseModel):
    id: int
    name: str

@app.get("/me", response_model=Out)
def me():
    return {"id": 7, "name": "Ada", "role": "admin", "token": "s3cret"}
```

What JSON does `GET /me` return?
---answer
{"id": 7, "name": "Ada"}
---solution
{"id": 7, "name": "Ada"}
:::

:::exercise
id: fm-predict-default
level: 2
title: Predict: defaults fill in
mode: answer
---
```python
class Task(BaseModel):
    title: str
    done: bool = False
    tags: list[str] = []

@app.post("/tasks")
def add(task: Task):
    return task
```

A client POSTs `{"title": "write tests"}`. What JSON comes back?
---answer
{"title": "write tests", "done": false, "tags": []}
---solution
{"title": "write tests", "done": false, "tags": []}
:::

:::exercise
id: fm-predict-coerce
level: 3
title: Predict: lax conversion
mode: answer
---
Same `Task` model. The client sends `{"title": "deploy", "done": "true"}` (note the **string** `"true"`). What JSON comes back?
---answer
{"title": "deploy", "done": true, "tags": []}
---solution
{"title": "deploy", "done": true, "tags": []}
:::

:::exercise
id: fm-predict-loc
level: 3
title: Predict: where it failed
mode: answer
---
```python
class Item(BaseModel):
    name: str
    price: float

@app.post("/items")
def create(item: Item): ...
```

The client sends `{"name": "Bolt"}`. Write the `loc` of the validation error as JSON.
---answer
["body", "price"]
---solution
["body", "price"]
:::
