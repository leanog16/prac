---
id: spring-validation
title: Validation & error handling
summary: Bean Validation annotations on records, @Valid and @Validated, validating path and query parameters, nested and custom constraints, custom exceptions, @RestControllerAdvice with @ExceptionHandler, RFC 9457 ProblemDetail responses, and mapping exceptions to the right status codes.
minutes: 35
---
## Bean Validation

Add `spring-boot-starter-validation` and annotate your request DTOs with **Jakarta Bean Validation** constraints:

```java
import jakarta.validation.constraints.*;

public record CreateUser(
        @NotBlank @Size(min = 3, max = 30) String username,
        @NotBlank @Email String email,
        @Min(13) @Max(120) int age,
        @NotNull @Past LocalDate birthday
) {}
```

Then ask Spring to validate the body with **`@Valid`**:

```java
@PostMapping("/api/users")
public ResponseEntity<UserResponse> create(@Valid @RequestBody CreateUser body) { ... }
```

Invalid input never reaches your method: Spring throws `MethodArgumentNotValidException`, which becomes a **400 Bad Request**.

| Constraint | Checks |
|---|---|
| `@NotNull` | not `null` |
| `@NotEmpty` | not null and not empty (strings, collections) |
| `@NotBlank` | not null and has a non-whitespace character (strings) |
| `@Size(min, max)` | length of a string or size of a collection |
| `@Min`, `@Max` | numeric bounds |
| `@Positive`, `@PositiveOrZero`, `@Negative` | sign |
| `@DecimalMin("0.01")` | bounds for `BigDecimal` |
| `@Email` | email format |
| `@Pattern(regexp = "...")` | regex match |
| `@Past`, `@Future`, `@PastOrPresent` | dates |

> [!warn] `@NotNull` vs `@NotEmpty` vs `@NotBlank`
> For a username, `" "` passes `@NotNull` and `@NotEmpty` but fails `@NotBlank`. For strings you usually want `@NotBlank`.

### Nested objects and lists

Constraints on a nested object only run if you cascade with `@Valid` on the field:

```java
public record CreateOrder(
        @NotNull @Valid Address shipping,
        @NotEmpty List<@Valid OrderLine> lines
) {}
```

### Path and query parameters

To validate simple parameters, put **`@Validated`** on the controller class:

```java
@Validated
@RestController
public class ProductController {
    @GetMapping("/api/products")
    public List<Product> list(@RequestParam(defaultValue = "20") @Max(100) int limit) { ... }
}
```

A violation there is a **400** too (`HandlerMethodValidationException` in Spring 6.1+).

### Custom constraints

When no built-in fits, write your own annotation and validator:

```java
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = SkuValidator.class)
public @interface ValidSku {
    String message() default "must look like ABC-1234";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

public class SkuValidator implements ConstraintValidator<ValidSku, String> {
    public boolean isValid(String value, ConstraintValidatorContext ctx) {
        return value == null || value.matches("[A-Z]{3}-\\d{4}");   // null handled by @NotNull
    }
}
```

## Custom exceptions

Your service layer should throw meaningful exceptions, not return nulls or error codes:

```java
public class NotFoundException extends RuntimeException {
    public NotFoundException(String message) { super(message); }
}

public Book get(long id) {
    return repo.findById(id).orElseThrow(() -> new NotFoundException("Book " + id + " not found"));
}
```

An unhandled exception becomes a **500**. Two ways to map it to the right status:

```java
@ResponseStatus(HttpStatus.NOT_FOUND)                       // quick: fixed status on the class
public class NotFoundException extends RuntimeException { ... }
```

or, better, a central handler.

## @RestControllerAdvice: one place for error handling

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(NotFoundException.class)
    public ProblemDetail handleNotFound(NotFoundException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setTitle("Resource not found");
        return pd;
    }

    @ExceptionHandler(DuplicateException.class)
    public ProblemDetail handleDuplicate(DuplicateException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            errors.put(fe.getField(), fe.getDefaultMessage());
        }
        pd.setProperty("errors", errors);
        return pd;
    }
}
```

`@RestControllerAdvice` applies to every controller. Spring picks the **most specific** matching `@ExceptionHandler`, so handling `NotFoundException` and, separately, `RuntimeException` works as you'd expect.

## ProblemDetail: a standard error format

`ProblemDetail` implements **RFC 9457** ("Problem Details for HTTP APIs"), so clients get a consistent shape, served as `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Resource not found",
  "status": 404,
  "detail": "Book 42 not found",
  "instance": "/api/books/42"
}
```

Setting `spring.mvc.problemdetails.enabled=true` makes Spring's **built-in** errors (400 type mismatches, 405, 415…) use the same format.

## Which status for which failure?

| Situation | Status |
|---|---|
| malformed JSON, failed validation, wrong parameter type | 400 Bad Request |
| not authenticated | 401 Unauthorized |
| authenticated but not allowed | 403 Forbidden |
| resource doesn't exist | 404 Not Found |
| wrong HTTP method on an existing path | 405 Method Not Allowed |
| duplicate (unique email), version conflict | 409 Conflict |
| wrong `Content-Type` | 415 Unsupported Media Type |
| well-formed but breaks a business rule | 422 Unprocessable Entity (or 400; be consistent) |
| bug, unexpected exception | 500 Internal Server Error |

Never leak stack traces or SQL errors to clients. Log them server-side and return a generic 500 detail.

:::quiz
q: A record has `@NotBlank String name` but the controller method lacks `@Valid`. What happens with `{"name": ""}`?
- 400 Bad Request
+ nothing: the constraint isn't checked, the method runs with an empty name
- 500 Internal Server Error
- Spring refuses to start
why: Constraints are only evaluated when validation is triggered by @Valid (or @Validated).
:::

:::quiz
q: Which constraint rejects `"   "` (only spaces)?
- @NotNull
- @NotEmpty
+ @NotBlank
- @Size(max = 10)
why: @NotBlank requires at least one non-whitespace character.
:::

:::quiz
q: What does `@RestControllerAdvice` do?
+ declares exception handlers (and more) that apply to all controllers
- validates every request body automatically
- logs every request
- replaces @RestController
why: It's the central place for cross-controller error handling.
:::

:::quiz
q: Registering a user with an email that already exists should return…
- 400
- 404
+ 409
- 500
why: 409 Conflict signals the request conflicts with the current state of the resource.
:::

:::exercise
id: sv-constraints
level: 2
title: Constrain a DTO
mode: code
lang: java
file: CreateProduct.java
---
Add constraints: `name` must be **not blank** and at most **100** characters; `price` must be **positive**; `stock` must be **zero or more**.
---starter
package com.example.demo;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;

public record CreateProduct(
        String name,
        BigDecimal price,
        int stock
) {}
---rule
@NotBlank\s+(@Size\(\s*max\s*=\s*100\s*\)\s+)?String\s+name|@Size\(\s*max\s*=\s*100\s*\)\s+@NotBlank\s+String\s+name
`name`: `@NotBlank`
---rule
@Size\(\s*max\s*=\s*100\s*\)[^,]*String\s+name|@Size\(\s*(min\s*=\s*\d+\s*,\s*)?max\s*=\s*100\s*\)
`name`: `@Size(max = 100)`
---rule
@Positive\s+(@NotNull\s+)?BigDecimal\s+price|@NotNull\s+@Positive\s+BigDecimal\s+price
`price`: `@Positive`
---rule
@PositiveOrZero\s+int\s+stock|@Min\(\s*0\s*\)\s+int\s+stock
`stock`: `@PositiveOrZero`
---solution
package com.example.demo;

import jakarta.validation.constraints.*;
import java.math.BigDecimal;

public record CreateProduct(
        @NotBlank @Size(max = 100) String name,
        @NotNull @Positive BigDecimal price,
        @PositiveOrZero int stock
) {}
:::

:::exercise
id: sv-valid
level: 1
title: Trigger validation
mode: code
lang: java
file: ProductController.java
---
Make Spring validate the request body of `create`.
---starter
package com.example.demo;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductService products;

    public ProductController(ProductService products) {
        this.products = products;
    }

    @PostMapping
    public ProductResponse create(@RequestBody CreateProduct body) {
        return products.create(body);
    }
}
---rule
create\(\s*(@Valid\s+@RequestBody|@RequestBody\s+@Valid)\s+CreateProduct\s+body\s*\)
`@Valid @RequestBody CreateProduct body`
---solution
package com.example.demo;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductService products;

    public ProductController(ProductService products) {
        this.products = products;
    }

    @PostMapping
    public ProductResponse create(@Valid @RequestBody CreateProduct body) {
        return products.create(body);
    }
}
:::

:::exercise
id: sv-param
level: 2
title: Validate a query parameter
mode: code
lang: java
file: ProductController.java
---
Cap the `limit` query parameter at **100** with a constraint, and enable parameter validation on the controller class.
---starter
package com.example.demo;

import jakarta.validation.constraints.Max;
import java.util.List;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
public class ProductController {

    @GetMapping("/api/products")
    public List<String> list(@RequestParam(defaultValue = "20") int limit) {
        return List.of();
    }
}
---rule
@Validated\s*\n\s*@RestController|@RestController\s*\n\s*@Validated
`@Validated` on the class
---rule
@RequestParam\(\s*defaultValue\s*=\s*"20"\s*\)\s+@Max\(\s*100\s*\)\s+int\s+limit|@Max\(\s*100\s*\)\s+@RequestParam\(\s*defaultValue\s*=\s*"20"\s*\)\s+int\s+limit
`@Max(100)` on `limit`
---solution
package com.example.demo;

import jakarta.validation.constraints.Max;
import java.util.List;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Validated
@RestController
public class ProductController {

    @GetMapping("/api/products")
    public List<String> list(@RequestParam(defaultValue = "20") @Max(100) int limit) {
        return List.of();
    }
}
:::

:::exercise
id: sv-exception
level: 2
title: A not-found exception
mode: code
lang: java
file: ProductService.java
---
Write `public class ProductNotFoundException extends RuntimeException` with a constructor taking `long id` that calls `super("Product " + id + " not found")`. Then make `get(long id)` return `repo.findById(id).orElseThrow(() -> new ProductNotFoundException(id))`.
---starter
package com.example.demo;

import org.springframework.stereotype.Service;

@Service
public class ProductService {

    private final ProductRepository repo;

    public ProductService(ProductRepository repo) {
        this.repo = repo;
    }

    public Product get(long id) {
        return repo.findById(id).orElse(null);
    }
}
---rule
class\s+ProductNotFoundException\s+extends\s+RuntimeException
`class ProductNotFoundException extends RuntimeException`
---rule
ProductNotFoundException\(\s*long\s+id\s*\)\s*\{\s*super\(\s*"Product "\s*\+\s*id\s*\+\s*" not found"\s*\)
`super("Product " + id + " not found")`
---rule
orElseThrow\(\s*\(\)\s*->\s*new\s+ProductNotFoundException\(\s*id\s*\)\s*\)
`orElseThrow(() -> new ProductNotFoundException(id))`
---rule
!orElse\(\s*null\s*\)
No `orElse(null)`
---solution
package com.example.demo;

import org.springframework.stereotype.Service;

class ProductNotFoundException extends RuntimeException {
    public ProductNotFoundException(long id) {
        super("Product " + id + " not found");
    }
}

@Service
public class ProductService {

    private final ProductRepository repo;

    public ProductService(ProductRepository repo) {
        this.repo = repo;
    }

    public Product get(long id) {
        return repo.findById(id).orElseThrow(() -> new ProductNotFoundException(id));
    }
}
:::

:::exercise
id: sv-advice
level: 3
title: A global handler with ProblemDetail
mode: code
lang: java
file: ApiExceptionHandler.java
---
Write `ApiExceptionHandler` annotated `@RestControllerAdvice`, with an `@ExceptionHandler(ProductNotFoundException.class)` method returning `ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage())`.
---starter
package com.example.demo;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
---rule
@RestControllerAdvice\s*\n\s*public\s+class\s+ApiExceptionHandler
`@RestControllerAdvice public class ApiExceptionHandler`
---rule
@ExceptionHandler\(\s*ProductNotFoundException\.class\s*\)
`@ExceptionHandler(ProductNotFoundException.class)`
---rule
public\s+ProblemDetail\s+\w+\(\s*ProductNotFoundException\s+ex\s*\)
Returns `ProblemDetail`, takes the exception
---rule
ProblemDetail\.forStatusAndDetail\(\s*HttpStatus\.NOT_FOUND\s*,\s*ex\.getMessage\(\s*\)\s*\)
`ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage())`
---solution
package com.example.demo;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ProductNotFoundException.class)
    public ProblemDetail handleNotFound(ProductNotFoundException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
    }
}
:::

:::exercise
id: sv-field-errors
level: 4
title: Report every field error
mode: code
lang: java
file: ApiExceptionHandler.java
---
Add a handler for `MethodArgumentNotValidException` that returns a 400 `ProblemDetail` with detail `"Validation failed"` and a property `"errors"`: a `Map<String, String>` from each `FieldError`'s `getField()` to its `getDefaultMessage()`.
---starter
package com.example.demo;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
}
---rule
@ExceptionHandler\(\s*MethodArgumentNotValidException\.class\s*\)
`@ExceptionHandler(MethodArgumentNotValidException.class)`
---rule
ProblemDetail\.forStatusAndDetail\(\s*HttpStatus\.BAD_REQUEST\s*,\s*"Validation failed"\s*\)
400 with `"Validation failed"`
---rule
ex\.getBindingResult\(\s*\)\.getFieldErrors\(\s*\)
Iterate `ex.getBindingResult().getFieldErrors()`
---rule
\.put\(\s*\w+\.getField\(\s*\)\s*,\s*\w+\.getDefaultMessage\(\s*\)\s*\)|toMap\(\s*FieldError::getField\s*,\s*FieldError::getDefaultMessage
Map field → message
---rule
\.setProperty\(\s*"errors"\s*,\s*\w+\s*\)
`setProperty("errors", ...)`
---solution
package com.example.demo;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            errors.put(fe.getField(), fe.getDefaultMessage());
        }
        pd.setProperty("errors", errors);
        return pd;
    }
}
:::

:::exercise
id: sv-nested
level: 3
title: Cascade into nested objects
mode: code
lang: java
file: CreateOrder.java
---
The `Address` record has its own constraints, but they're ignored. Make validation cascade into `shipping` (which must also be non-null) and into **each element** of `lines` (which must not be empty).
---starter
package com.example.demo;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

public record CreateOrder(
        Address shipping,
        List<OrderLine> lines
) {}
---rule
@NotNull\s+@Valid\s+Address\s+shipping|@Valid\s+@NotNull\s+Address\s+shipping
`@NotNull @Valid Address shipping`
---rule
@NotEmpty\s+List<\s*@Valid\s+OrderLine\s*>\s+lines|@Valid\s+@NotEmpty\s+List<\s*OrderLine\s*>\s+lines|@NotEmpty\s+@Valid\s+List<\s*OrderLine\s*>\s+lines
`@NotEmpty List<@Valid OrderLine> lines`
---solution
package com.example.demo;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

public record CreateOrder(
        @NotNull @Valid Address shipping,
        @NotEmpty List<@Valid OrderLine> lines
) {}
:::

:::exercise
id: sv-predict-status
level: 2
title: Predict: no handler
mode: answer
---
A service throws `IllegalStateException("stock exhausted")`. There's no `@ExceptionHandler` for it and no `@ResponseStatus` on it. What status code does the client get?
---answer
500
---solution
500
:::
