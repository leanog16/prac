---
id: fastapi-http
title: HTTP & REST essentials
summary: The protocol under every web API — requests and responses, methods and their semantics, status codes, headers, JSON, and how to design RESTful resource URLs.
minutes: 25
---
## A request, a response

Every web API interaction is an **HTTP request** answered by an **HTTP response**.

```http
GET /items/42?include=price HTTP/1.1
Host: api.example.com
Accept: application/json
Authorization: Bearer eyJhbGciOi...
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 41

{"id": 42, "name": "Widget", "price": 9.99}
```

| Part | Example | Notes |
|---|---|---|
| method | `GET` | what to do |
| path | `/items/42` | which resource; `42` is a **path parameter** |
| query string | `?include=price` | optional modifiers, filters, paging: **query parameters** |
| headers | `Accept`, `Authorization`, `Content-Type` | metadata: formats, auth, caching |
| body | JSON | the data sent (POST/PUT/PATCH) or returned |
| status line | `200 OK` | the outcome, as a number |

## Methods

| Method | Meaning | Body? | Safe | Idempotent |
|---|---|---|---|---|
| `GET` | read a resource | no | yes | yes |
| `POST` | create a resource / trigger an action | yes | no | **no** |
| `PUT` | replace a resource entirely | yes | no | yes |
| `PATCH` | partially update | yes | no | not guaranteed |
| `DELETE` | remove | usually no | no | yes |

- **Safe**: doesn't change server state.
- **Idempotent**: doing it twice has the same effect as once. `DELETE /items/42` twice leaves item 42 deleted; `POST /items` twice creates two items. This is why clients can safely retry PUT and DELETE but must be careful with POST.

## Status codes

| Range | Meaning | The ones to know |
|---|---|---|
| 2xx | success | **200** OK, **201** Created, **204** No Content |
| 3xx | redirection | 301 Moved Permanently, 304 Not Modified |
| 4xx | **client** error | **400** Bad Request, **401** Unauthorized (not authenticated), **403** Forbidden (authenticated, not allowed), **404** Not Found, **405** Method Not Allowed, **409** Conflict, **422** Unprocessable Entity (validation failed: FastAPI's default) |
| 5xx | **server** error | **500** Internal Server Error, 502 Bad Gateway, 503 Service Unavailable |

> [!exam] 401 vs 403
> 401 means "I don't know who you are" (missing or bad credentials). 403 means "I know who you are, and you can't do this".

## JSON

APIs exchange **JSON**: objects `{"key": value}`, arrays `[1, 2]`, strings (double quotes only), numbers, `true`/`false`, `null`. Python dicts map to objects, lists to arrays, `None` to `null`. The `Content-Type: application/json` header says the body is JSON.

## Designing REST URLs

Resources are **nouns**; methods are the verbs.

| Action | Request | Success status |
|---|---|---|
| list items | `GET /items` | 200 |
| get one item | `GET /items/42` | 200 (404 if missing) |
| create an item | `POST /items` with JSON body | **201** (+ the created item) |
| replace an item | `PUT /items/42` | 200 |
| update some fields | `PATCH /items/42` | 200 |
| delete an item | `DELETE /items/42` | **204** (no body) |
| a user's orders | `GET /users/7/orders` | 200 |
| filter/sort/page | `GET /items?category=tools&sort=price&limit=20` | 200 |

Avoid verbs in paths (`/getItems`, `/deleteItem?id=4`) and avoid encoding actions that a method already expresses.

## Trying requests

`curl` is the universal HTTP client:

```bash
curl http://localhost:8000/items/42
curl -i http://localhost:8000/items/42                 # include response headers
curl -X POST http://localhost:8000/items \
     -H "Content-Type: application/json" \
     -d '{"name": "Widget", "price": 9.99}'
curl -X DELETE http://localhost:8000/items/42
```

FastAPI also gives you an interactive browser UI at `/docs` for free (next module).

:::quiz
q: Which method is NOT idempotent?
- GET
- PUT
- DELETE
+ POST
why: Repeating a POST typically creates another resource. PUT and DELETE leave the same end state.
:::

:::quiz
q: A request is missing its API token. The best status code is…
+ 401
- 403
- 404
- 500
why: 401 Unauthorized means the client isn't authenticated. 403 is for authenticated clients lacking permission.
:::

:::quiz
q: In `GET /users/7/orders?status=open`, what is `status`?
- a path parameter
+ a query parameter
- a header
- part of the body
why: Everything after ? is the query string.
:::

:::quiz
q: Which status fits a successful DELETE that returns no body?
- 200
- 201
+ 204
- 404
why: 204 No Content signals success with an empty body.
:::

:::quiz
q: Which URL design is RESTful for "deactivate user 7"?
- `GET /deactivateUser?id=7`
- `POST /users/deactivate/7/now`
+ `PATCH /users/7` with body `{"active": false}`
- `DELETE /users/7/active=false`
why: Treat the user as a resource and update its state with PATCH.
:::

:::exercise
id: fh-created
level: 1
title: Created!
mode: answer
---
What status code should a successful `POST /items` that created a new item return?
---answer
201
---solution
201
:::

:::exercise
id: fh-not-found
level: 1
title: Missing resource
mode: answer
---
`GET /items/999` asks for an item that doesn't exist. Status code?
---answer
404
---solution
404
:::

:::exercise
id: fh-validation
level: 1
title: Bad input
mode: answer
---
FastAPI receives `GET /items/abc` for a route whose `item_id` is declared as `int`. Which status code does FastAPI return by default?
---answer
422
---solution
422
:::

:::exercise
id: fh-partial
level: 2
title: Change one field
mode: answer
---
Which HTTP method is the conventional choice for updating **only** the `price` of item 42?
---answer
PATCH
---solution
PATCH
:::

:::exercise
id: fh-design-list
level: 2
title: Design the request
mode: answer
---
Write the method and path (no host) to list the comments of blog post 15, e.g. `GET /something`.
---answer
GET /posts/15/comments
---solution
GET /posts/15/comments
:::

:::exercise
id: fh-query
level: 2
title: Filter with a query string
mode: answer
---
Write the full path with query string for "the second page of products in the `tools` category, 20 per page", using parameters named `category`, `page` and `limit` (in that order).
---answer
/products?category=tools&page=2&limit=20
---answer
GET /products?category=tools&page=2&limit=20
---solution
/products?category=tools&page=2&limit=20
:::

:::exercise
id: fh-forbidden
level: 2
title: Logged in, not allowed
mode: answer
---
A logged-in regular user calls `DELETE /admin/users/3`, which only admins may do. Status code?
---answer
403
---solution
403
:::

:::exercise
id: fh-json
level: 3
title: Python to JSON
mode: answer
---
A FastAPI endpoint returns the Python dict `{"ok": True, "items": [], "next": None}`. Write the JSON body it sends.
---answer
{"ok": true, "items": [], "next": null}
---solution
{"ok": true, "items": [], "next": null}
:::

:::exercise
id: fh-idempotent
level: 3
title: Safe to retry?
mode: answer
---
A network glitch means a client doesn't know whether its request succeeded. Of `POST /orders` and `PUT /orders/17`, which one is safe to simply retry? Answer with the method name.
---answer
PUT
---solution
PUT
:::
