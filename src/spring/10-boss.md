---
id: spring-boss
title: Boss round: build & debug
summary: Interview- and production-grade problems that combine everything: a full feature slice, startup failures to diagnose, transaction and lazy-loading bugs, a security misconfiguration, a slow endpoint, and a containerized build.
minutes: 60
---
> [!project] Taskboard, final step: returns and credits
> The last feature closes the loop: returning a task, computing the client credit for late work, and a nightly job that emails reminders. It touches every layer you've built.

## A debugging playbook

| Symptom | Look at | Usual cause |
|---|---|---|
| `APPLICATION FAILED TO START` … `required a bean of type X that could not be found` | the package of X and of the main class | X lacks a stereotype annotation, or lives outside the component-scan base package |
| `expected single matching bean but found 2` | implementations of the interface | add `@Primary` or `@Qualifier` |
| `Port 8080 was already in use` | `ss -ltnp`, other running apps | change `server.port` or stop the other process |
| Endpoint returns 404 but the code exists | `@RestController`, mapping paths, class-level `@RequestMapping` | not scanned, wrong prefix, `@Controller` without `@ResponseBody` |
| Validation annotations ignored | the controller parameter | missing `@Valid` (or `@Validated` for parameters) |
| `LazyInitializationException` | where the entity is serialized | lazy association touched outside the transaction; fetch it or return a DTO |
| Changes not saved / not rolled back | where `@Transactional` sits | self-invocation, private method, checked exception |
| Every request is 401 | the security filter chain | matcher order, missing `permitAll()`, CSRF on a POST |
| Endpoint gets slower as data grows | SQL log (`logging.level.org.hibernate.SQL=debug`) | N+1 queries, missing index, no pagination |

Each exercise below combines several lessons. Read the requirements carefully: the checker grades each one.

## Worked example: putting the credit rule where it belongs

"A credit of `creditPerDay` for every day a task is finished late" is a pure calculation. It needs no database, no Spring, no clock of its own. Make it a small, separately testable method on the domain object:

```java
public class Assignment {
    // ...
    public BigDecimal creditOn(LocalDate returnDate, BigDecimal creditPerDay) {
        long lateDays = ChronoUnit.DAYS.between(dueOn, returnDate);
        return lateDays > 0 ? creditPerDay.multiply(BigDecimal.valueOf(lateDays)) : BigDecimal.ZERO;
    }
}
```

The service orchestrates; the entity calculates:

```java
@Transactional
public ReturnResponse putBack(long assignmentId, long memberId) {
    Assignment assignment = assignments.findById(assignmentId).orElseThrow(() -> new LoanNotFoundException(assignmentId));
    if (!assignment.getMember().getId().equals(memberId)) throw new AccessDeniedException("Not your assignment");
    if (assignment.getCompletedOn() != null) throw new AlreadyCompletedException(assignmentId);

    LocalDate today = LocalDate.now(clock);
    assignment.setCompletedOn(today);
    assignment.getTask().setAvailable(true);
    return new ReturnResponse(assignment.getId(), assignment.creditOn(today, props.creditPerDay()));
}
```

`BigDecimal` for money, never `double`: `0.1 + 0.2` in floating point is `0.30000000000000004`, and credits must add up to the cent.

:::exercise
id: sb-feature
level: 4
title: A complete feature slice
mode: code
lang: java
file: NoteController.java
---
Write a `NoteController` for `/api/notes` (class-level mapping) using an injected `NoteService notes` (constructor injection, `final` field):

- `GET /api/notes/{id}` returns `ResponseEntity<NoteResponse>`: `notes.find(id)` mapped to 200, or 404 when empty.
- `POST /api/notes` takes a **validated** `CreateNote` body and returns **201** with a `Location` of `/api/notes/{id}` and the created `NoteResponse` (from `notes.create(body)`).
- `DELETE /api/notes/{id}` calls `notes.delete(id)` and returns **204**.
---starter
package com.example.demo;

import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

public class NoteController {
}
---rule
@RestController
`@RestController`
---rule
@RequestMapping\(\s*"/api/notes"\s*\)
`@RequestMapping("/api/notes")`
---rule
private\s+final\s+NoteService\s+notes\s*;[\s\S]*public\s+NoteController\(\s*NoteService\s+notes\s*\)
Constructor-injected `final NoteService notes`
---rule
@GetMapping\(\s*"/\{id\}"\s*\)\s*\n\s*public\s+ResponseEntity<NoteResponse>\s+\w+\(\s*@PathVariable\s+(long|Long)\s+id\s*\)
`GET /{id}` returning `ResponseEntity<NoteResponse>`
---rule
notes\.find\(\s*id\s*\)\s*\.map\(\s*ResponseEntity::ok\s*\)\s*\.orElse(Get)?\(\s*(\(\)\s*->\s*)?ResponseEntity\.notFound\(\s*\)\.build\(\s*\)\s*\)
200 or 404 from `notes.find(id)`
---rule
@PostMapping\s*\n\s*public\s+ResponseEntity<NoteResponse>\s+\w+\(\s*(@Valid\s+@RequestBody|@RequestBody\s+@Valid)\s+CreateNote\s+body\s*\)
`POST` with `@Valid @RequestBody CreateNote body`
---rule
ResponseEntity\.created\(\s*(URI\.create\(\s*"/api/notes/"\s*\+\s*\w+\.id\(\s*\)\s*\)|\w+)\s*\)\.body\(\s*\w+\s*\)
`ResponseEntity.created(...).body(...)` with `/api/notes/{id}`
---rule
URI\.create\(\s*"/api/notes/"\s*\+\s*\w+\.id\(\s*\)\s*\)
Location `/api/notes/` + id
---rule
@DeleteMapping\(\s*"/\{id\}"\s*\)\s*\n\s*@ResponseStatus\(\s*HttpStatus\.NO_CONTENT\s*\)|@ResponseStatus\(\s*HttpStatus\.NO_CONTENT\s*\)\s*\n\s*@DeleteMapping\(\s*"/\{id\}"\s*\)|ResponseEntity\.noContent\(\s*\)\.build\(\s*\)
`DELETE /{id}` with 204
---rule
notes\.delete\(\s*id\s*\)
Calls `notes.delete(id)`
---solution
package com.example.demo;

import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/notes")
public class NoteController {

    private final NoteService notes;

    public NoteController(NoteService notes) {
        this.notes = notes;
    }

    @GetMapping("/{id}")
    public ResponseEntity<NoteResponse> get(@PathVariable long id) {
        return notes.find(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<NoteResponse> create(@Valid @RequestBody CreateNote body) {
        NoteResponse created = notes.create(body);
        return ResponseEntity.created(URI.create("/api/notes/" + created.id())).body(created);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        notes.delete(id);
    }
}
:::

:::exercise
id: sb-port-clash
level: 3
title: Two instances, one machine
---
Build `~/spring-app` quietly and start one instance on the default port. Then start a **second** instance on port **8081** using a system property (`-D…`), and print `GET /hello?name=two` from the second one. Discard both instances' output.
---solution
cd spring-app
./mvnw -q package
java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null
java -Dserver.port=8081 -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null
curl -s "localhost:8081/hello?name=two"
:::

:::exercise
id: sb-missing-endpoint
level: 3
title: The endpoint that 404s
mode: file
file: spring-app/src/main/java/com/example/demo/PingController.java
---run
cd spring-app && ./mvnw -q package && java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null 2>&1
curl -s localhost:8080/api/ping; echo
---
`PingController` compiles, but `GET /api/ping` returns 404. Fix it so the endpoint returns `pong`. (There are two problems.)
---starter
package com.example.demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@RequestMapping("/api")
public class PingController {

    @GetMapping("/pingg")
    public String ping() {
        return "pong";
    }
}
---hint
Is the class registered as a controller at all? And look closely at the path.
---solution
package com.example.demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class PingController {

    @GetMapping("/ping")
    public String ping() {
        return "pong";
    }
}
:::

:::exercise
id: sb-self-invocation
level: 4
title: The transaction that never was
mode: code
lang: java
file: ImportService.java
---
`importAll` calls `importOne` for each row, and failed rows were supposed to roll back individually. They don't: the `@Transactional` on `importOne` is ignored because of **self-invocation**. Fix it by moving `importOne` into a new `@Service` class `RowImporter` (with `@Transactional(propagation = Propagation.REQUIRES_NEW)`), and have `ImportService` inject `RowImporter` through its constructor and call `rowImporter.importOne(row)`.
---starter
package com.example.demo;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ImportService {

    private final ProductRepository repo;

    public ImportService(ProductRepository repo) {
        this.repo = repo;
    }

    public void importAll(List<Row> rows) {
        for (Row row : rows) {
            try {
                importOne(row);
            } catch (RuntimeException e) {
                // skip bad rows
            }
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void importOne(Row row) {
        repo.save(row.toProduct());
    }
}
---rule
@Service\s*\n\s*(public\s+)?class\s+RowImporter
A `@Service` class `RowImporter`
---rule
class\s+RowImporter[\s\S]*@Transactional\(\s*propagation\s*=\s*Propagation\.REQUIRES_NEW\s*\)\s*\n\s*public\s+void\s+importOne\(\s*Row\s+row\s*\)
`RowImporter.importOne` is `REQUIRES_NEW`
---rule
private\s+final\s+RowImporter\s+rowImporter\s*;
`ImportService` has a `final RowImporter rowImporter`
---rule
public\s+ImportService\([^)]*RowImporter\s+rowImporter[^)]*\)
Injected through the constructor
---rule
rowImporter\.importOne\(\s*row\s*\)
Calls `rowImporter.importOne(row)`
---rule
!^[ \t]+importOne\(\s*row\s*\)\s*;
No more self-invocation
---solution
package com.example.demo;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ImportService {

    private final RowImporter rowImporter;

    public ImportService(RowImporter rowImporter) {
        this.rowImporter = rowImporter;
    }

    public void importAll(List<Row> rows) {
        for (Row row : rows) {
            try {
                rowImporter.importOne(row);
            } catch (RuntimeException e) {
                // skip bad rows
            }
        }
    }
}

@Service
class RowImporter {

    private final ProductRepository repo;

    RowImporter(ProductRepository repo) {
        this.repo = repo;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void importOne(Row row) {
        repo.save(row.toProduct());
    }
}
:::

:::exercise
id: sb-n-plus-one
level: 4
title: The slow orders page
mode: code
lang: java
file: OrderService.java
---
`GET /api/orders` got slow: the SQL log shows one query for orders, then one per order for its customer. Add a repository method `List<Order> findAllWithCustomer()` using `@Query("select o from Order o join fetch o.customer")`, and use it in `listOrders`, which should be a **read-only** transaction and return DTOs `new OrderSummary(o.getId(), o.getCustomer().getName())`.
---starter
package com.example.demo;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

interface OrderRepository extends JpaRepository<Order, Long> {
}

@Service
public class OrderService {

    private final OrderRepository orders;

    public OrderService(OrderRepository orders) {
        this.orders = orders;
    }

    public List<OrderSummary> listOrders() {
        return orders.findAll().stream()
                .map(o -> new OrderSummary(o.getId(), o.getCustomer().getName()))
                .toList();
    }
}
---rule
@Query\(\s*"select o from Order o join fetch o\.customer"\s*\)\s*\n\s*List<Order>\s+findAllWithCustomer\(\s*\)\s*;
`@Query(...) List<Order> findAllWithCustomer();`
---rule
@Transactional\(\s*readOnly\s*=\s*true\s*\)\s*\n\s*public\s+List<OrderSummary>\s+listOrders
Read-only transaction on `listOrders`
---rule
orders\.findAllWithCustomer\(\s*\)
Uses `findAllWithCustomer()`
---rule
!orders\.findAll\(\s*\)
No more `findAll()`
---rule
new\s+OrderSummary\(\s*o\.getId\(\s*\)\s*,\s*o\.getCustomer\(\s*\)\.getName\(\s*\)\s*\)
Still maps to `OrderSummary`
---solution
package com.example.demo;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("select o from Order o join fetch o.customer")
    List<Order> findAllWithCustomer();
}

@Service
public class OrderService {

    private final OrderRepository orders;

    public OrderService(OrderRepository orders) {
        this.orders = orders;
    }

    @Transactional(readOnly = true)
    public List<OrderSummary> listOrders() {
        return orders.findAllWithCustomer().stream()
                .map(o -> new OrderSummary(o.getId(), o.getCustomer().getName()))
                .toList();
    }
}
:::

:::exercise
id: sb-security-order
level: 4
title: Everything is 401
mode: code
lang: java
file: SecurityConfig.java
---
After a refactor, even `/actuator/health` and `POST /api/auth/login` return 401. Fix the rules so `/actuator/health` and `/api/auth/**` are public, `/api/admin/**` needs role `ADMIN`, and everything else needs authentication. Keep the API stateless with CSRF disabled.
---starter
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/actuator/health", "/api/auth/**").permitAll())
            .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()));
        return http.build();
    }
}
---hint
Rules are evaluated in order; `anyRequest()` must come last. And a POST without a CSRF token is rejected unless CSRF is disabled.
---rule
\.csrf\(\s*(\w+)\s*->\s*\1\.disable\(\s*\)\s*\)|\.csrf\(\s*AbstractHttpConfigurer::disable\s*\)
CSRF disabled
---rule
requestMatchers\(\s*"/actuator/health"\s*,\s*"/api/auth/\*\*"\s*\)\.permitAll\(\s*\)|requestMatchers\(\s*"/api/auth/\*\*"\s*,\s*"/actuator/health"\s*\)\.permitAll\(\s*\)
Public paths permitted
---rule
permitAll\(\s*\)[\s\S]*anyRequest\(\s*\)\.authenticated\(\s*\)
`permitAll()` before `anyRequest()`
---rule
hasRole\(\s*"ADMIN"\s*\)[\s\S]*anyRequest\(\s*\)\.authenticated\(\s*\)
`hasRole("ADMIN")` before `anyRequest()`
---rule
anyRequest\(\s*\)\.authenticated\(\s*\)\s*\)
`anyRequest()` is the last rule
---rule
SessionCreationPolicy\.STATELESS
Still stateless
---solution
package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health", "/api/auth/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()));
        return http.build();
    }
}
:::

:::exercise
id: sb-dockerfile
level: 4
title: Containerize it
mode: file
file: spring-app/Dockerfile
cwd: /home/student
---run
cd spring-app && docker build -q -t demo . >/dev/null && docker run -d --name demo -p 8080:8080 demo >/dev/null
curl -s localhost:8080/api/status; echo
docker inspect -f '{{.Config.User}}' demo
---
Write a **multi-stage** Dockerfile for `~/spring-app`: a build stage `FROM eclipse-temurin:21-jdk AS build` that copies the project to `/app` and runs `./mvnw -q package -DskipTests`; a runtime stage `FROM eclipse-temurin:21-jre` that copies the jar from the build stage to `/app/app.jar`, runs as user `1000`, exposes 8080 and starts with `java -jar /app/app.jar` (exec form).
---solution
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY . .
RUN ./mvnw -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/demo-0.0.1-SNAPSHOT.jar /app/app.jar
USER 1000
EXPOSE 8080
CMD ["java", "-jar", "/app/app.jar"]
:::

:::exercise
id: sb-predict-rollback
level: 3
title: Predict: what got saved?
mode: answer
---
```java
@Transactional
public void placeOrder(Order order) throws PaymentException {
    orders.save(order);
    payments.charge(order);   // throws PaymentException (a checked exception)
}
```

`charge` throws. Is the order row in the database after the method exits? Answer `yes` or `no`.
---answer
yes
---solution
yes
---explain
Checked exceptions don't trigger a rollback by default, so the transaction commits the saved order. Add `rollbackFor = PaymentException.class` (or `Exception.class`).
:::

:::exercise
id: proj-sp-10-fine
level: 3
title: "Project 10: the credit calculation"
mode: code
lang: java
file: Assignment.java
path: spring/src/main/java/dev/taskboard/Assignment.java
---
Add `public BigDecimal creditOn(LocalDate returnDate, BigDecimal creditPerDay)` to `Assignment`: compute `long lateDays = ChronoUnit.DAYS.between(dueOn, returnDate)` and return `creditPerDay.multiply(BigDecimal.valueOf(lateDays))` when `lateDays > 0`, otherwise `BigDecimal.ZERO`.
---starter
package dev.taskboard;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

public class Assignment {

    private LocalDate dueOn;
}
---rule
public\s+BigDecimal\s+creditOn\(\s*LocalDate\s+returnDate\s*,\s*BigDecimal\s+creditPerDay\s*\)
The method signature
---rule
long\s+lateDays\s*=\s*ChronoUnit\.DAYS\.between\(\s*dueOn\s*,\s*returnDate\s*\)
Count the late days
---rule
creditPerDay\.multiply\(\s*BigDecimal\.valueOf\(\s*lateDays\s*\)\s*\)
Multiply with `BigDecimal`
---rule
BigDecimal\.ZERO
Zero when on time
---rule
lateDays\s*>\s*0
Only when late
---rule
!double
No `double`
---solution
package dev.taskboard;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

public class Assignment {

    private LocalDate dueOn;

    public BigDecimal creditOn(LocalDate returnDate, BigDecimal creditPerDay) {
        long lateDays = ChronoUnit.DAYS.between(dueOn, returnDate);
        return lateDays > 0 ? creditPerDay.multiply(BigDecimal.valueOf(lateDays)) : BigDecimal.ZERO;
    }
}
:::

:::exercise
id: proj-sp-10-reminders
level: 4
title: "Project 10b: nightly reminders"
mode: code
lang: java
file: ReminderJob.java
path: spring/src/main/java/dev/taskboard/ReminderJob.java
---
Write a `@Component` `ReminderJob` with constructor-injected `AssignmentRepository assignments`, `Notifier notifier` and `Clock clock`, and a method `sendReminders()` scheduled with `@Scheduled(cron = "0 0 8 * * *")` that loops over `assignments.findOverdue(LocalDate.now(clock))` and calls `notifier.remind(assignment.getMember().getEmail(), assignment.getTask().getTitle())` for each. Make it a **read-only** transaction.
---starter
package dev.taskboard;

import java.time.Clock;
import java.time.LocalDate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
---rule
@Component\s*\n\s*public\s+class\s+ReminderJob
`@Component public class ReminderJob`
---rule
public\s+ReminderJob\(\s*AssignmentRepository\s+assignments\s*,\s*Notifier\s+notifier\s*,\s*Clock\s+clock\s*\)
Constructor injection
---rule
@Scheduled\(\s*cron\s*=\s*"0\s+0\s+8\s+\*\s+\*\s+\*"\s*\)
Every day at 08:00
---rule
@Transactional\(\s*readOnly\s*=\s*true\s*\)
Read-only transaction
---rule
for\s*\(\s*Assignment\s+(\w+)\s*:\s*assignments\.findOverdue\(\s*LocalDate\.now\(\s*clock\s*\)\s*\)\s*\)
Loop over overdue assignments
---rule
notifier\.remind\(\s*\w+\.getMember\(\s*\)\.getEmail\(\s*\)\s*,\s*\w+\.getTask\(\s*\)\.getTitle\(\s*\)\s*\)
Send each reminder
---solution
package dev.taskboard;

import java.time.Clock;
import java.time.LocalDate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class ReminderJob {

    private final AssignmentRepository assignments;
    private final Notifier notifier;
    private final Clock clock;

    public ReminderJob(AssignmentRepository assignments, Notifier notifier, Clock clock) {
        this.assignments = assignments;
        this.notifier = notifier;
        this.clock = clock;
    }

    @Scheduled(cron = "0 0 8 * * *")
    @Transactional(readOnly = true)
    public void sendReminders() {
        for (Assignment assignment : assignments.findOverdue(LocalDate.now(clock))) {
            notifier.remind(assignment.getMember().getEmail(), assignment.getTask().getTitle());
        }
    }
}
:::
