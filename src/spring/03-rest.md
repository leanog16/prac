---
id: spring-rest
title: REST controllers
summary: @RestController and request mappings, path variables, query parameters with defaults, request bodies as Java records, ResponseEntity and status codes, Location headers for created resources, request headers, and how Jackson turns objects into JSON.
minutes: 35
---
> [!project] Bookshelf, step 3: the catalog API
> The catalog is Bookshelf's front door: list books, look one up, add one, remove one. This step writes `BookController` with request and response records.

## A controller

```java
@RestController
@RequestMapping("/api/books")
public class BookController {

    private final BookService books;

    public BookController(BookService books) {
        this.books = books;
    }

    @GetMapping
    public List<Book> list() {
        return books.findAll();
    }

    @GetMapping("/{id}")
    public Book get(@PathVariable long id) {
        return books.get(id);
    }
}
```

- **`@RestController`** = `@Controller` + `@ResponseBody`: return values are written to the response body as JSON (by Jackson), not treated as view names.
- **`@RequestMapping("/api/books")`** on the class sets a prefix for every method.
- **`@GetMapping`, `@PostMapping`, `@PutMapping`, `@PatchMapping`, `@DeleteMapping`** map one HTTP method and path each.

Try it on the practice project:

```bash run
cd spring-app
cat > src/main/java/com/example/demo/EchoController.java <<'EOF'
package com.example.demo;

import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/echo")
public class EchoController {

    @GetMapping("/{word}")
    public Map<String, String> echo(@PathVariable String word, @RequestParam(defaultValue = "1") String times) {
        return Map.of("word", word, "times", times);
    }
}
EOF
./mvnw -q package
java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null
curl -s "localhost:8080/api/echo/hi?times=3"; echo
```

## Reading the request

| Annotation | Reads | Example |
|---|---|---|
| `@PathVariable` | a `{placeholder}` in the path | `/books/{id}` → `@PathVariable long id` |
| `@RequestParam` | a query-string parameter | `?page=2` → `@RequestParam int page` |
| `@RequestParam(defaultValue = "20")` | optional, with a default | |
| `@RequestParam(required = false)` | optional, `null` when absent | or use `Optional<String>` |
| `@RequestBody` | the JSON body, deserialized | `@RequestBody CreateBook body` |
| `@RequestHeader` | a header | `@RequestHeader("X-Request-ID") String rid` |

Spring converts types for you: `"42"` → `long`, `"true"` → `boolean`, `"2026-11-13"` → `LocalDate`. A value that doesn't convert (`/books/abc` for a `long`) is a **400 Bad Request**.

> [!tip] Compile with `-parameters`
> `@PathVariable long id` works without repeating the name (`@PathVariable("id")`) because the Boot parent compiles with `-parameters`, which keeps parameter names in the bytecode.

## Request and response bodies as records

Java **records** are ideal DTOs (data transfer objects): immutable, concise, and Jackson handles them out of the box.

```java
public record CreateBook(String title, String author, int year) {}
public record BookResponse(long id, String title, String author, int year) {}

@PostMapping
public BookResponse create(@RequestBody CreateBook body) {
    Book saved = books.create(body.title(), body.author(), body.year());
    return new BookResponse(saved.getId(), saved.getTitle(), saved.getAuthor(), saved.getYear());
}
```

Keep DTOs separate from your database entities. Returning entities directly leaks internal fields, couples your API to your schema, and with JPA can trigger lazy-loading surprises during serialization.

## Status codes and ResponseEntity

A plain return value is a **200 OK**. For other codes, either annotate the method or return a `ResponseEntity`:

```java
@DeleteMapping("/{id}")
@ResponseStatus(HttpStatus.NO_CONTENT)                   // 204, no body
public void delete(@PathVariable long id) {
    books.delete(id);
}

@PostMapping
public ResponseEntity<BookResponse> create(@RequestBody CreateBook body) {
    BookResponse created = books.create(body);
    URI location = URI.create("/api/books/" + created.id());
    return ResponseEntity.created(location).body(created);   // 201 + Location header
}

@GetMapping("/{id}")
public ResponseEntity<BookResponse> get(@PathVariable long id) {
    return books.find(id)                          // Optional<BookResponse>
            .map(ResponseEntity::ok)               // 200 with body
            .orElse(ResponseEntity.notFound().build());   // 404, no body
}
```

`ResponseEntity` gives full control: status, headers and body. Useful builders: `ok(body)`, `created(uri)`, `accepted()`, `noContent()`, `badRequest()`, `notFound()`, `status(HttpStatus.CONFLICT)`.

For the `Location` header, `ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}").buildAndExpand(id).toUri()` builds an absolute URL from the incoming request.

## How JSON is produced

Jackson serializes **getters** (or record components) to JSON fields:

| Java | JSON |
|---|---|
| `record Point(int x, int y)` | `{"x":1,"y":2}` |
| `List<String>` | `["a","b"]` |
| `Map<String, Object>` | `{"key": value}` |
| `null` field | `"field": null` (unless configured otherwise) |
| `LocalDate` | `"2026-11-13"` (ISO-8601, with Boot's defaults) |
| `Optional.empty()` | `null` |

Useful annotations: `@JsonProperty("first_name")` to rename, `@JsonIgnore` to hide a field, `@JsonInclude(JsonInclude.Include.NON_NULL)` to omit nulls. Globally, `spring.jackson.property-naming-strategy=SNAKE_CASE` switches every field to snake_case.

## Consuming and producing other types

```java
@PostMapping(value = "/import", consumes = "text/csv")
public ImportResult importCsv(@RequestBody String csv) { ... }

@GetMapping(value = "/{id}/cover", produces = MediaType.IMAGE_PNG_VALUE)
public byte[] cover(@PathVariable long id) { ... }
```

A request with the wrong `Content-Type` gets **415 Unsupported Media Type**; one whose `Accept` header can't be satisfied gets **406 Not Acceptable**.

## Worked example: one request through the layers

`POST /api/books` with `{"isbn": "9780441013593", "title": "Dune", "author": "Frank Herbert", "year": 1965}`:

```
HTTP ──► BookController.create(@RequestBody BookRequest)     web layer: HTTP ↔ Java
              │  converts the request record, calls the service
              ▼
          BookService.add(BookRequest)                         business layer: rules
              │  checks the ISBN isn't taken, builds a Book
              ▼
          BookRepository.save(Book)                            persistence layer: SQL
              ▲
          returns Book ──► BookResponse.from(book) ──► 201 Created + Location: /api/books/7
```

Each layer has one job, and only the controller knows about HTTP. That's why the service can be reused by a CSV importer or a scheduled job, and why each layer can be tested on its own (lesson 9).

```java
public record BookRequest(String isbn, String title, String author, int year) {}

public record BookResponse(long id, String isbn, String title, String author, int year, boolean available) {
    static BookResponse from(Book b) {
        return new BookResponse(b.getId(), b.getIsbn(), b.getTitle(), b.getAuthor(), b.getYear(), b.isAvailable());
    }
}
```

> [!plain] In plain English
> A controller method is "when this HTTP request arrives, call this Java method". Spring turns the incoming JSON into a record for you, and turns whatever you return back into JSON.

## Common mistakes

> [!mistake] Business logic in controllers
> Checking "is this ISBN already used?" inside the controller means the importer and the scheduled job skip that check. Controllers should translate HTTP and delegate.

:::quiz
q: What's the difference between `@Controller` and `@RestController`?
+ @RestController adds @ResponseBody, so return values are written as the response body (JSON) instead of being resolved as view names
- @RestController only supports GET
- @Controller can't use @GetMapping
- there is none
why: @RestController = @Controller + @ResponseBody on every method.
:::

:::quiz
q: `@GetMapping("/{id}")` with `@PathVariable long id` receives `/api/books/abc`. What happens?
- id is 0
- 404 Not Found
+ 400 Bad Request: "abc" can't be converted to long
- 500 Internal Server Error
why: Type conversion failures on request parameters are client errors.
:::

:::quiz
q: Which return gives `201 Created` with a `Location` header?
- `ResponseEntity.ok(body)`
+ `ResponseEntity.created(uri).body(body)`
- `ResponseEntity.status(201).build()`
- `new ResponseEntity<>(body, HttpStatus.OK)`
why: created(uri) sets both the status and the Location header.
:::

:::quiz
q: Why return DTOs (records) instead of JPA entities from controllers?
- Jackson can't serialize entities
+ it decouples the API from the database schema and avoids leaking fields and lazy-loading problems
- records are faster to query
- entities can't have getters
why: DTOs are your API contract; entities are your persistence model. Keep them separate.
:::

:::exercise
id: sr-path
level: 1
title: A path variable
mode: file
file: spring-app/src/main/java/com/example/demo/WelcomeController.java
---run
cd spring-app && ./mvnw -q package && java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null 2>&1
curl -s localhost:8080/welcome/Ada; echo
curl -s localhost:8080/welcome/Linus; echo
---
Create `WelcomeController` (package `com.example.demo`) with `GET /welcome/{name}` returning the string `"Welcome, <name>!"`.
---starter
package com.example.demo;

import org.springframework.web.bind.annotation.*;

@RestController
public class WelcomeController {
}
---solution
package com.example.demo;

import org.springframework.web.bind.annotation.*;

@RestController
public class WelcomeController {

    @GetMapping("/welcome/{name}")
    public String welcome(@PathVariable String name) {
        return "Welcome, " + name + "!";
    }
}
:::

:::exercise
id: sr-query
level: 2
title: Query parameters with defaults
mode: file
file: spring-app/src/main/java/com/example/demo/SearchController.java
---run
cd spring-app && ./mvnw -q package && java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null 2>&1
curl -s "localhost:8080/api/search?q=spring"; echo
curl -s "localhost:8080/api/search?q=java&sort=new"; echo
---
Create `SearchController` with a class-level `@RequestMapping("/api")` and `GET /search` taking `q` (required) and `sort` (default `"relevance"`), returning `Map.of("q", q, "sort", sort)`.
---starter
package com.example.demo;

import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
public class SearchController {
}
---solution
package com.example.demo;

import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class SearchController {

    @GetMapping("/search")
    public Map<String, String> search(@RequestParam String q, @RequestParam(defaultValue = "relevance") String sort) {
        return Map.of("q", q, "sort", sort);
    }
}
:::

:::exercise
id: sr-record-body
level: 2
title: A record request body
mode: code
lang: java
file: TaskController.java
---
Define `public record CreateTask(String title, int priority) {}` and a `@PostMapping("/api/tasks")` method `create(@RequestBody CreateTask body)` that returns `tasks.create(body)` (a `TaskResponse`).
---starter
package com.example.demo;

import org.springframework.web.bind.annotation.*;

@RestController
public class TaskController {

    private final TaskService tasks;

    public TaskController(TaskService tasks) {
        this.tasks = tasks;
    }
}
---rule
record\s+CreateTask\(\s*String\s+title\s*,\s*int\s+priority\s*\)
`record CreateTask(String title, int priority)`
---rule
@PostMapping\(\s*"/api/tasks"\s*\)
`@PostMapping("/api/tasks")`
---rule
TaskResponse\s+create\(\s*@RequestBody\s+CreateTask\s+body\s*\)
`TaskResponse create(@RequestBody CreateTask body)`
---rule
return\s+tasks\.create\(\s*body\s*\)\s*;
Return `tasks.create(body)`
---solution
package com.example.demo;

import org.springframework.web.bind.annotation.*;

@RestController
public class TaskController {

    public record CreateTask(String title, int priority) {}

    private final TaskService tasks;

    public TaskController(TaskService tasks) {
        this.tasks = tasks;
    }

    @PostMapping("/api/tasks")
    public TaskResponse create(@RequestBody CreateTask body) {
        return tasks.create(body);
    }
}
:::

:::exercise
id: sr-created
level: 3
title: 201 with Location
mode: code
lang: java
file: TaskController.java
---
Change `create` to return `ResponseEntity<TaskResponse>`: build `URI location = URI.create("/api/tasks/" + created.id())` and return `ResponseEntity.created(location).body(created)`.
---starter
package com.example.demo;

import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService tasks;

    public TaskController(TaskService tasks) {
        this.tasks = tasks;
    }

    @PostMapping
    public TaskResponse create(@RequestBody CreateTask body) {
        return tasks.create(body);
    }
}
---rule
public\s+ResponseEntity<TaskResponse>\s+create\(\s*@RequestBody\s+CreateTask\s+body\s*\)
Return type `ResponseEntity<TaskResponse>`
---rule
TaskResponse\s+created\s*=\s*tasks\.create\(\s*body\s*\)
`TaskResponse created = tasks.create(body);`
---rule
URI\.create\(\s*"/api/tasks/"\s*\+\s*created\.id\(\s*\)\s*\)
`URI.create("/api/tasks/" + created.id())`
---rule
return\s+ResponseEntity\.created\(\s*\w+\s*\)\.body\(\s*created\s*\)
`ResponseEntity.created(location).body(created)`
---solution
package com.example.demo;

import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService tasks;

    public TaskController(TaskService tasks) {
        this.tasks = tasks;
    }

    @PostMapping
    public ResponseEntity<TaskResponse> create(@RequestBody CreateTask body) {
        TaskResponse created = tasks.create(body);
        URI location = URI.create("/api/tasks/" + created.id());
        return ResponseEntity.created(location).body(created);
    }
}
:::

:::exercise
id: sr-optional-404
level: 3
title: 200 or 404
mode: code
lang: java
file: TaskController.java
---
Write `@GetMapping("/{id}")` `ResponseEntity<TaskResponse> get(@PathVariable long id)` that returns `tasks.find(id)` (an `Optional<TaskResponse>`) mapped to `ResponseEntity.ok`, or `ResponseEntity.notFound().build()` when empty.
---starter
package com.example.demo;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService tasks;

    public TaskController(TaskService tasks) {
        this.tasks = tasks;
    }
}
---rule
@GetMapping\(\s*"/\{id\}"\s*\)
`@GetMapping("/{id}")`
---rule
ResponseEntity<TaskResponse>\s+get\(\s*@PathVariable\s+(long|Long)\s+id\s*\)
`ResponseEntity<TaskResponse> get(@PathVariable long id)`
---rule
tasks\.find\(\s*id\s*\)\s*\.map\(\s*ResponseEntity::ok\s*\)
`.map(ResponseEntity::ok)`
---rule
\.orElse(Get)?\(\s*(\(\)\s*->\s*)?ResponseEntity\.notFound\(\s*\)\.build\(\s*\)\s*\)
`.orElse(ResponseEntity.notFound().build())`
---solution
package com.example.demo;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService tasks;

    public TaskController(TaskService tasks) {
        this.tasks = tasks;
    }

    @GetMapping("/{id}")
    public ResponseEntity<TaskResponse> get(@PathVariable long id) {
        return tasks.find(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
:::

:::exercise
id: sr-delete
level: 2
title: Delete with 204
mode: code
lang: java
file: TaskController.java
---
Add `@DeleteMapping("/{id}")` `void delete(@PathVariable long id)` that calls `tasks.delete(id)` and responds **204 No Content** using `@ResponseStatus`.
---starter
package com.example.demo;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService tasks;

    public TaskController(TaskService tasks) {
        this.tasks = tasks;
    }
}
---rule
@DeleteMapping\(\s*"/\{id\}"\s*\)
`@DeleteMapping("/{id}")`
---rule
@ResponseStatus\(\s*(code\s*=\s*|value\s*=\s*)?HttpStatus\.NO_CONTENT\s*\)
`@ResponseStatus(HttpStatus.NO_CONTENT)`
---rule
void\s+delete\(\s*@PathVariable\s+(long|Long)\s+id\s*\)
`void delete(@PathVariable long id)`
---rule
tasks\.delete\(\s*id\s*\)\s*;
Call `tasks.delete(id)`
---solution
package com.example.demo;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService tasks;

    public TaskController(TaskService tasks) {
        this.tasks = tasks;
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        tasks.delete(id);
    }
}
:::

:::exercise
id: sr-header
level: 2
title: Read a header
mode: code
lang: java
file: TraceController.java
---
Write `@GetMapping("/trace")` `String trace(@RequestHeader("X-Request-ID") String requestId)` that returns `"request " + requestId`.
---starter
package com.example.demo;

import org.springframework.web.bind.annotation.*;

@RestController
public class TraceController {
}
---rule
@GetMapping\(\s*"/trace"\s*\)
`@GetMapping("/trace")`
---rule
String\s+trace\(\s*@RequestHeader\(\s*"X-Request-ID"\s*\)\s+String\s+requestId\s*\)
`@RequestHeader("X-Request-ID") String requestId`
---rule
return\s+"request "\s*\+\s*requestId\s*;
Return `"request " + requestId`
---solution
package com.example.demo;

import org.springframework.web.bind.annotation.*;

@RestController
public class TraceController {

    @GetMapping("/trace")
    public String trace(@RequestHeader("X-Request-ID") String requestId) {
        return "request " + requestId;
    }
}
:::

:::exercise
id: sr-predict-json
level: 2
title: Predict: record to JSON
mode: answer
---
```java
public record Money(String currency, long cents) {}

@GetMapping("/price")
public Money price() { return new Money("EUR", 1999); }
```

What JSON does `GET /price` return?
---answer
{"currency":"EUR","cents":1999}
---solution
{"currency":"EUR","cents":1999}
:::

:::exercise
id: proj-sp-03-catalog-run
level: 2
title: "Project 3: a first catalog endpoint"
mode: file
file: spring-app/src/main/java/com/example/demo/CatalogController.java
---run
cd spring-app && ./mvnw -q package && java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null 2>&1
curl -s localhost:8080/api/books/featured; echo
curl -s localhost:8080/api/books/isbn/9780441013593; echo
---
Write `CatalogController` under `/api/books` (class-level mapping) with `GET /featured` returning `Map.of("title", "Dune", "author", "Frank Herbert")`, and `GET /isbn/{isbn}` returning `Map.of("isbn", isbn, "found", "false")`.
---starter
package com.example.demo;

import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
public class CatalogController {
}
---solution
package com.example.demo;

import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/books")
public class CatalogController {

    @GetMapping("/featured")
    public Map<String, String> featured() {
        return Map.of("title", "Dune", "author", "Frank Herbert");
    }

    @GetMapping("/isbn/{isbn}")
    public Map<String, String> byIsbn(@PathVariable String isbn) {
        return Map.of("isbn", isbn, "found", "false");
    }
}
:::

:::exercise
id: proj-sp-03-controller
level: 3
title: "Project 3b: BookController"
mode: code
lang: java
file: BookController.java
---
Write `BookController` for `/api/books` with an injected `BookService books`:

- `GET` (no path) returns `List<BookResponse>` from `books.findAll()`;
- `GET /{id}` returns `books.get(id)`;
- `POST` takes `@RequestBody BookRequest body` and returns `ResponseEntity<BookResponse>`: **201** with `Location` `/api/books/{id}` via `ResponseEntity.created(URI.create("/api/books/" + created.id())).body(created)`;
- `DELETE /{id}` returns **204** via `@ResponseStatus(HttpStatus.NO_CONTENT)`.
---starter
package org.library.bookshelf;

import java.net.URI;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/books")
public class BookController {

    private final BookService books;

    public BookController(BookService books) {
        this.books = books;
    }
}
---rule
@GetMapping\s*\n\s*public\s+List<BookResponse>\s+\w+\(\s*\)\s*\{\s*return\s+books\.findAll\(\s*\)\s*;
`GET` → `books.findAll()`
---rule
@GetMapping\(\s*"/\{id\}"\s*\)\s*\n\s*public\s+BookResponse\s+\w+\(\s*@PathVariable\s+(long|Long)\s+id\s*\)\s*\{\s*return\s+books\.get\(\s*id\s*\)\s*;
`GET /{id}` → `books.get(id)`
---rule
@PostMapping\s*\n\s*public\s+ResponseEntity<BookResponse>\s+\w+\(\s*@RequestBody\s+BookRequest\s+body\s*\)
`POST` with `@RequestBody BookRequest`
---rule
ResponseEntity\.created\(\s*URI\.create\(\s*"/api/books/"\s*\+\s*\w+\.id\(\s*\)\s*\)\s*\)\.body\(\s*\w+\s*\)
201 with Location
---rule
@DeleteMapping\(\s*"/\{id\}"\s*\)\s*\n\s*@ResponseStatus\(\s*HttpStatus\.NO_CONTENT\s*\)|@ResponseStatus\(\s*HttpStatus\.NO_CONTENT\s*\)\s*\n\s*@DeleteMapping\(\s*"/\{id\}"\s*\)
`DELETE /{id}` → 204
---solution
package org.library.bookshelf;

import java.net.URI;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/books")
public class BookController {

    private final BookService books;

    public BookController(BookService books) {
        this.books = books;
    }

    @GetMapping
    public List<BookResponse> list() {
        return books.findAll();
    }

    @GetMapping("/{id}")
    public BookResponse get(@PathVariable long id) {
        return books.get(id);
    }

    @PostMapping
    public ResponseEntity<BookResponse> create(@RequestBody BookRequest body) {
        BookResponse created = books.add(body);
        return ResponseEntity.created(URI.create("/api/books/" + created.id())).body(created);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        books.remove(id);
    }
}
:::
