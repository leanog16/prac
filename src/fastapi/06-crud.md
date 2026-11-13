---
id: fastapi-crud
title: Building a CRUD API & routers
summary: A complete create-read-update-delete resource with correct status codes, ID generation and 404 handling, then splitting an app into APIRouters with prefixes and tags.
minutes: 35
---
## A complete resource

Here's the whole lifecycle of a `todos` resource, stored in memory to keep the focus on the API:

```python title=main.py
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

app = FastAPI()


class TodoIn(BaseModel):
    title: str
    done: bool = False


class TodoOut(TodoIn):
    id: int


todos: dict[int, TodoOut] = {}
next_id = 1


@app.get("/todos", response_model=list[TodoOut])
def list_todos(done: bool | None = None):
    items = list(todos.values())
    if done is not None:
        items = [t for t in items if t.done == done]
    return items


@app.post("/todos", response_model=TodoOut, status_code=status.HTTP_201_CREATED)
def create_todo(todo: TodoIn):
    global next_id
    new = TodoOut(id=next_id, **todo.model_dump())
    todos[next_id] = new
    next_id += 1
    return new


def get_or_404(todo_id: int) -> TodoOut:
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todos[todo_id]


@app.get("/todos/{todo_id}", response_model=TodoOut)
def read_todo(todo_id: int):
    return get_or_404(todo_id)


@app.put("/todos/{todo_id}", response_model=TodoOut)
def replace_todo(todo_id: int, todo: TodoIn):
    get_or_404(todo_id)
    todos[todo_id] = TodoOut(id=todo_id, **todo.model_dump())
    return todos[todo_id]


@app.delete("/todos/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo(todo_id: int):
    get_or_404(todo_id)
    del todos[todo_id]
```

Things to notice:

- **Input vs output models**: clients never send `id`; the server assigns it. `TodoOut` extends `TodoIn` with `id`.
- **POST returns 201** and the created object (including its new id).
- A helper (`get_or_404`) keeps the "not found" logic in one place.
- **Filtering via query parameters** (`?done=true`) on the collection route.
- **DELETE returns 204** with no body.

## Splitting into routers

As the app grows, group routes into `APIRouter`s, one module per resource:

```python title=routers/todos.py
from fastapi import APIRouter

router = APIRouter(prefix="/todos", tags=["todos"])


@router.get("/")
def list_todos():
    ...


@router.get("/{todo_id}")
def read_todo(todo_id: int):
    ...
```

```python title=main.py
from fastapi import FastAPI
from routers import todos, users

app = FastAPI()
app.include_router(todos.router)
app.include_router(users.router)
```

- `prefix="/todos"` is prepended to every route in the router: `@router.get("/{todo_id}")` serves `/todos/{todo_id}`.
- `tags` group the endpoints in `/docs`.
- `include_router(router, prefix="/api/v1")` can add *another* prefix at inclusion time, which is handy for API versioning.
- Routers can also carry `dependencies=[...]` (next module), e.g. "every route here requires auth".

> [!tip] A typical layout
> `main.py` (create app, include routers) · `routers/` (one file per resource) · `schemas.py` (Pydantic models) · `models.py` (database tables) · `crud.py` or `services/` (data access and business logic) · `dependencies.py` · `tests/`.

:::quiz
q: Router created with `APIRouter(prefix="/orders")` has `@router.get("/{order_id}")`, included with `app.include_router(router, prefix="/api")`. What's the full path?
- /orders/{order_id}
- /api/{order_id}
+ /api/orders/{order_id}
- /{order_id}/orders/api
why: Prefixes stack: include_router's prefix, then the router's prefix, then the route path.
:::

:::quiz
q: Why do `TodoIn` and `TodoOut` differ?
+ Clients shouldn't choose the id; the server assigns it and returns it
- Pydantic requires two models per resource
- TodoOut is faster to serialize
- To support PATCH
why: Separate schemas keep server-controlled fields out of the input.
:::

:::quiz
q: Which status code fits `POST /todos` success?
- 200
+ 201
- 202
- 204
why: 201 Created, typically with the new resource in the body.
:::

:::quiz
q: What does `tags=["todos"]` on a router affect?
- URL paths
- authentication
+ grouping in the generated docs
- response format
why: Tags are OpenAPI metadata used to group operations in /docs.
:::

:::exercise
id: fc-list-filter
level: 2
title: Filter a collection
mode: code
lang: python
file: main.py
---
Add `GET /books` with an optional query parameter `author: str | None = None`. Return all books from the `books` list, or only those whose `"author"` equals the given author.
---starter
from fastapi import FastAPI

app = FastAPI()

books = [
    {"title": "Dune", "author": "Herbert"},
    {"title": "Emma", "author": "Austen"},
    {"title": "Persuasion", "author": "Austen"},
]
---rule
@app\.get\(\s*["']/books["']
`GET /books`
---rule
author\s*:\s*(str\s*\|\s*None|Optional\[str\])\s*=\s*None
`author: str | None = None`
---rule
if\s+author(\s+is\s+not\s+None)?\s*:|if\s+author\s+is\s+None\s*:
Check whether `author` was given
---rule
\[\s*\w+\s+for\s+\w+\s+in\s+books\s+if\s+\w+\[\s*["']author["']\s*\]\s*==\s*author\s*\]|filter\(
Filter the books by author
---solution
from fastapi import FastAPI

app = FastAPI()

books = [
    {"title": "Dune", "author": "Herbert"},
    {"title": "Emma", "author": "Austen"},
    {"title": "Persuasion", "author": "Austen"},
]


@app.get("/books")
def list_books(author: str | None = None):
    if author is not None:
        return [b for b in books if b["author"] == author]
    return books
:::

:::exercise
id: fc-create-id
level: 3
title: Create with a server-side id
mode: code
lang: python
file: main.py
---
Implement `POST /notes` (status **201**) taking a `NoteIn` body: assign the next id (`len(notes) + 1`), store `{"id": new_id, **note.model_dump()}` in `notes[new_id]`, and return it.
---starter
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
notes: dict[int, dict] = {}


class NoteIn(BaseModel):
    text: str
---rule
@app\.post\(\s*["']/notes["'][^)]*status_code\s*=\s*(201|status\.HTTP_201_CREATED)
`@app.post("/notes", status_code=201)`
---rule
def\s+\w+\(\s*note\s*:\s*NoteIn\s*\)
Takes `note: NoteIn`
---rule
=\s*len\(\s*notes\s*\)\s*\+\s*1
Compute the id as `len(notes) + 1`
---rule
\{\s*["']id["']\s*:\s*\w+\s*,\s*\*\*note\.model_dump\(\)\s*\}
Build `{"id": new_id, **note.model_dump()}`
---rule
notes\[\s*\w+\s*\]\s*=
Store it in `notes`
---solution
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
notes: dict[int, dict] = {}


class NoteIn(BaseModel):
    text: str


@app.post("/notes", status_code=201)
def create_note(note: NoteIn):
    new_id = len(notes) + 1
    stored = {"id": new_id, **note.model_dump()}
    notes[new_id] = stored
    return stored
:::

:::exercise
id: fc-router
level: 2
title: Make a router
mode: code
lang: python
file: routers/products.py
---
Write `routers/products.py`: create `router = APIRouter(prefix="/products", tags=["products"])` and a route on it for `GET /products/{product_id}` (declare the path relative to the prefix) returning `{"id": product_id}` with an **int** id.
---starter
from fastapi import APIRouter
---rule
router\s*=\s*APIRouter\((?=[^)]*prefix\s*=\s*["']/products["'])(?=[^)]*tags\s*=\s*\[\s*["']products["']\s*\])
`APIRouter(prefix="/products", tags=["products"])`
---rule
@router\.get\(\s*["']/\{product_id\}["']
`@router.get("/{product_id}")` (relative path)
---rule
!@app\.
Use the router, not `app`
---rule
def\s+\w+\(\s*product_id\s*:\s*int\s*\)
`product_id: int`
---solution
from fastapi import APIRouter

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/{product_id}")
def read_product(product_id: int):
    return {"id": product_id}
:::

:::exercise
id: fc-include
level: 2
title: Wire up the routers
mode: code
lang: python
file: main.py
---
In `main.py`, create the app and include `products.router` and `orders.router`, both under the extra prefix `/api/v1`.
---starter
from fastapi import FastAPI

from routers import orders, products
---rule
^app\s*=\s*FastAPI\(
Create `app`
---rule
app\.include_router\(\s*products\.router\s*,\s*prefix\s*=\s*["']/api/v1["']\s*\)
Include `products.router` with `prefix="/api/v1"`
---rule
app\.include_router\(\s*orders\.router\s*,\s*prefix\s*=\s*["']/api/v1["']\s*\)
Include `orders.router` with `prefix="/api/v1"`
---solution
from fastapi import FastAPI

from routers import orders, products

app = FastAPI()
app.include_router(products.router, prefix="/api/v1")
app.include_router(orders.router, prefix="/api/v1")
:::

:::exercise
id: fc-put
level: 3
title: Replace with PUT
mode: code
lang: python
file: main.py
---
Implement `PUT /todos/{todo_id}`: respond **404** (`"Todo not found"`) if the id isn't in `todos`; otherwise replace it with `{"id": todo_id, **todo.model_dump()}` and return the new value.
---starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class TodoIn(BaseModel):
    title: str
    done: bool = False


todos = {1: {"id": 1, "title": "learn FastAPI", "done": False}}
---rule
@app\.put\(\s*["']/todos/\{todo_id\}["']
`@app.put("/todos/{todo_id}")`
---rule
def\s+\w+\(\s*todo_id\s*:\s*int\s*,\s*todo\s*:\s*TodoIn\s*\)
Takes `todo_id: int, todo: TodoIn`
---rule
raise\s+HTTPException\([^)]*404[^)]*["']Todo not found["']
404 when missing
---rule
todos\[\s*todo_id\s*\]\s*=\s*\{\s*["']id["']\s*:\s*todo_id\s*,\s*\*\*todo\.model_dump\(\)\s*\}
Replace with `{"id": todo_id, **todo.model_dump()}`
---solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class TodoIn(BaseModel):
    title: str
    done: bool = False


todos = {1: {"id": 1, "title": "learn FastAPI", "done": False}}


@app.put("/todos/{todo_id}")
def replace_todo(todo_id: int, todo: TodoIn):
    if todo_id not in todos:
        raise HTTPException(status_code=404, detail="Todo not found")
    todos[todo_id] = {"id": todo_id, **todo.model_dump()}
    return todos[todo_id]
:::

:::exercise
id: fc-full-crud
level: 4
title: The whole resource
mode: code
lang: python
file: main.py
---
Build all five operations for `/contacts` on the dict `contacts` (ids from `next_id`, which you increment): `GET /contacts` (list values), `GET /contacts/{contact_id}` (404 if missing), `POST /contacts` (201, returns the stored contact with its id), `PUT /contacts/{contact_id}` (404 if missing), `DELETE /contacts/{contact_id}` (204; 404 if missing). Use `ContactIn` as the body model.
---starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class ContactIn(BaseModel):
    name: str
    email: str


contacts: dict[int, dict] = {}
next_id = 1
---rule
@app\.get\(\s*["']/contacts["']
`GET /contacts`
---rule
@app\.get\(\s*["']/contacts/\{contact_id\}["']
`GET /contacts/{contact_id}`
---rule
@app\.post\(\s*["']/contacts["'][^)]*status_code\s*=\s*(201|status\.HTTP_201_CREATED)
`POST /contacts` with 201
---rule
@app\.put\(\s*["']/contacts/\{contact_id\}["']
`PUT /contacts/{contact_id}`
---rule
@app\.delete\(\s*["']/contacts/\{contact_id\}["'][^)]*status_code\s*=\s*(204|status\.HTTP_204_NO_CONTENT)
`DELETE /contacts/{contact_id}` with 204
---rule
global\s+next_id[\s\S]*next_id\s*\+=\s*1
Increment the global `next_id` when creating
---rule
(raise\s+HTTPException\([^)]*404[\s\S]*){1,}
Raise 404 for missing contacts
---rule
list\(\s*contacts\.values\(\)\s*\)|return\s+\[\s*\w+\s+for\s+\w+\s+in\s+contacts\.values\(\)\s*\]
The list route returns `list(contacts.values())`
---solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class ContactIn(BaseModel):
    name: str
    email: str


contacts: dict[int, dict] = {}
next_id = 1


def get_or_404(contact_id: int) -> dict:
    if contact_id not in contacts:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contacts[contact_id]


@app.get("/contacts")
def list_contacts():
    return list(contacts.values())


@app.get("/contacts/{contact_id}")
def read_contact(contact_id: int):
    return get_or_404(contact_id)


@app.post("/contacts", status_code=201)
def create_contact(contact: ContactIn):
    global next_id
    stored = {"id": next_id, **contact.model_dump()}
    contacts[next_id] = stored
    next_id += 1
    return stored


@app.put("/contacts/{contact_id}")
def replace_contact(contact_id: int, contact: ContactIn):
    get_or_404(contact_id)
    contacts[contact_id] = {"id": contact_id, **contact.model_dump()}
    return contacts[contact_id]


@app.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int):
    get_or_404(contact_id)
    del contacts[contact_id]
:::

:::exercise
id: fc-predict-prefix
level: 2
title: Predict: the final URL
mode: answer
---
```python
router = APIRouter(prefix="/reviews", tags=["reviews"])

@router.get("/{review_id}/likes")
def likes(review_id: int): ...

app.include_router(router, prefix="/v2")
```

What path serves `likes` for review 5?
---answer
/v2/reviews/5/likes
---solution
/v2/reviews/5/likes
:::

:::exercise
id: fc-predict-sequence
level: 3
title: Predict: a sequence of calls
mode: answer
---
Using the `todos` app from the lesson (ids start at 1), a fresh server receives: `POST /todos {"title": "a"}`, `POST /todos {"title": "b"}`, `DELETE /todos/1`, then `GET /todos`. What JSON does the last call return?
---answer
[{"title": "b", "done": false, "id": 2}]
---answer
[{"id": 2, "title": "b", "done": false}]
---solution
[{"title": "b", "done": false, "id": 2}]
:::
