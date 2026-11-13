---
id: spring-intro
title: Spring Boot essentials
summary: What Spring and Spring Boot are, starters and auto-configuration, the project layout, the Maven wrapper and the build lifecycle, @SpringBootApplication and component scanning, running the fat jar, and changing settings from the command line.
minutes: 30
---
## Spring and Spring Boot

**Spring** is a Java framework whose core is an **inversion-of-control container**: you write plain classes, and Spring creates them, wires them together and manages their lifecycle. On top of that core sit modules for web apps (Spring MVC), data access (Spring Data), security (Spring Security), messaging and more.

**Spring Boot** is Spring with the setup done for you:

- **Starters**: one dependency pulls in a coherent set of libraries. `spring-boot-starter-web` gives you Spring MVC, Jackson for JSON, validation hooks and an embedded Tomcat.
- **Auto-configuration**: Boot looks at your classpath and properties and configures beans for you. Is there a JDBC driver and a `spring.datasource.url`? You get a connection pool. Is Spring MVC on the classpath? You get a web server on port 8080.
- **An executable "fat" jar**: your code plus every dependency plus the server in one file. `java -jar app.jar` runs it anywhere Java is installed.
- **Opinionated defaults** you override with properties instead of code.

## The project layout

Generate projects at [start.spring.io](https://start.spring.io) (or from your IDE). The practice project `~/spring-app` has the standard Maven layout:

```
spring-app/
├── mvnw                         Maven wrapper: downloads the right Maven version
├── pom.xml                      dependencies and build plugins
└── src/
    ├── main/
    │   ├── java/com/example/demo/
    │   │   ├── DemoApplication.java     entry point
    │   │   └── HelloController.java
    │   └── resources/
    │       └── application.properties   configuration
    └── test/java/com/example/demo/
        └── DemoApplicationTests.java
```

```bash run
cd spring-app
cat src/main/java/com/example/demo/DemoApplication.java
```

## @SpringBootApplication

```java
@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
```

`@SpringBootApplication` combines three annotations:

| Annotation | Does |
|---|---|
| `@SpringBootConfiguration` | marks this class as a source of bean definitions |
| `@EnableAutoConfiguration` | turns on Boot's auto-configuration |
| `@ComponentScan` | finds `@Component`, `@Service`, `@RestController`… in **this package and its sub-packages** |

> [!warn] Package placement matters
> Component scanning starts at the package of the `@SpringBootApplication` class. A controller in `com.example.api` will **not** be found if the main class lives in `com.example.demo`. Keep the main class in the root package (`com.example.demo`) and everything else in sub-packages (`com.example.demo.orders`).

## The pom.xml

```xml
<parent>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-parent</artifactId>
  <version>3.3.5</version>
</parent>

<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

The **parent** manages versions: starters have no `<version>` because the Boot release picks a tested set of library versions for you. `<scope>test</scope>` keeps test libraries out of the production jar.

Common starters: `-web` (REST), `-data-jpa` (databases), `-validation` (Bean Validation), `-security`, `-actuator` (health and metrics), `-test`, `-webflux` (reactive), `-data-redis`, `-amqp` (RabbitMQ).

## Building with the Maven wrapper

Always use `./mvnw` (not a system `mvn`), so every developer and CI runner uses the same Maven version. Maven runs **lifecycle phases** in order: asking for a later phase runs all the earlier ones.

| Command | Does |
|---|---|
| `./mvnw compile` | compile `src/main/java` |
| `./mvnw test` | compile, then run the unit tests |
| `./mvnw package` | compile, test, and build `target/<artifact>-<version>.jar` |
| `./mvnw package -DskipTests` | build the jar without running tests |
| `./mvnw clean package` | delete `target/` first, then build |
| `./mvnw spring-boot:run` | run the app straight from source (development) |

```bash run
cd spring-app
./mvnw -q package
ls target
```

## Running the jar

```bash run
cd spring-app
./mvnw -q package
java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null
curl -s "localhost:8080/hello?name=Ada"; echo
curl -s localhost:8080/api/status; echo
```

Any property can be overridden at launch, without rebuilding. From highest to lowest precedence:

1. command-line arguments: `java -jar app.jar --server.port=9090`
2. Java system properties: `java -Dserver.port=9090 -jar app.jar`
3. environment variables: `SERVER_PORT=9090 java -jar app.jar` (**relaxed binding**: uppercase, dots become underscores)
4. `application-{profile}.properties` for the active profile
5. `application.properties` inside the jar

Environment variables are how containers and cloud platforms configure Spring apps, so `SPRING_DATASOURCE_URL`, `SERVER_PORT` and `SPRING_PROFILES_ACTIVE` are everywhere in Dockerfiles and Kubernetes manifests.

## Actuator

`spring-boot-starter-actuator` adds operational endpoints under `/actuator`: `health`, `info`, `metrics`, `env`, `loggers`, `prometheus` (with Micrometer). Only `health` is exposed over HTTP by default; expose more deliberately:

```properties
management.endpoints.web.exposure.include=health,info,prometheus
management.endpoint.health.probes.enabled=true    # /actuator/health/liveness and /readiness
```

Never expose `env`, `heapdump` or `beans` publicly: they leak configuration and secrets.

:::quiz
q: What does `@ComponentScan` (inside `@SpringBootApplication`) scan?
- the whole classpath
+ the main class's package and all its sub-packages
- only classes listed in application.properties
- only the `src/test` folder
why: Classes outside that package tree aren't found unless you configure extra packages.
:::

:::quiz
q: Why don't starter dependencies in the pom need a `<version>`?
+ the spring-boot-starter-parent manages a tested set of versions
- Maven always picks the latest version
- versions are set in application.properties
- starters are built into the JDK
why: The parent's dependency management pins compatible versions for every starter and library.
:::

:::quiz
q: `./mvnw package` is run. Which phases execute?
- only package
+ compile, test, then package
- package, then test
- clean, compile, package
why: Maven runs every phase up to the one requested. Add -DskipTests to skip tests.
:::

:::quiz
q: Which environment variable sets `spring.datasource.url`?
- spring.datasource.url
- SpringDatasourceUrl
+ SPRING_DATASOURCE_URL
- DATASOURCE_URL
why: Relaxed binding: uppercase, with dots (and dashes) replaced by underscores.
:::

:::exercise
id: si-package
level: 1
title: Build the jar
compare: verify
---
In `~/spring-app`, build the executable jar with the Maven wrapper (tests included).
---verify
ls spring-app/target
---solution
cd spring-app
./mvnw package
:::

:::exercise
id: si-run
level: 2
title: Build, run, call
---
Build `~/spring-app` quietly, start the jar in the background with output discarded, then print the response of `GET /hello?name=Grace`.
---hint
`./mvnw -q package`, then `java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null`.
---solution
cd spring-app
./mvnw -q package
java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null
curl -s "localhost:8080/hello?name=Grace"
:::

:::exercise
id: si-port-arg
level: 2
title: Another port, no rebuild
---
Port 8080 is taken. Build `~/spring-app` quietly, then run the jar on port **9090** using a **command-line argument** (output discarded), and print `GET /api/status` from that port.
---solution
cd spring-app
./mvnw -q package
java -jar target/demo-0.0.1-SNAPSHOT.jar --server.port=9090 > /dev/null
curl -s localhost:9090/api/status
:::

:::exercise
id: si-port-env
level: 2
title: Configure with the environment
---
Same as before, but set port **7070** with an **environment variable** instead of an argument. Print `GET /hello` from that port.
---solution
cd spring-app
./mvnw -q package
SERVER_PORT=7070 java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null
curl -s localhost:7070/hello
:::

:::exercise
id: si-actuator
level: 2
title: Is it healthy?
---
Build and start `~/spring-app` (output discarded) and print its actuator **health** endpoint.
---solution
cd spring-app
./mvnw -q package
java -jar target/demo-0.0.1-SNAPSHOT.jar > /dev/null
curl -s localhost:8080/actuator/health
:::

:::exercise
id: si-starter
level: 1
title: Pick the starter
mode: code
lang: xml
file: pom.xml
---
Add the dependency for **Spring Data JPA** to the `<dependencies>` section (no version).
---starter
<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
</dependencies>
---rule
<groupId>org\.springframework\.boot</groupId>\s*<artifactId>spring-boot-starter-data-jpa</artifactId>
`org.springframework.boot:spring-boot-starter-data-jpa`
---rule
!starter-data-jpa</artifactId>\s*<version>
No `<version>`: the parent manages it
---solution
<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
  </dependency>
</dependencies>
:::

:::exercise
id: si-scan
level: 3
title: Why is my controller ignored?
mode: answer
---
The main class is `com.shop.app.ShopApplication`. A controller lives in `com.shop.web.OrderController`, and its endpoints return 404. Which package should the controller move into (or under) so component scanning finds it? Give the package name.
---answer
com.shop.app
---answer
com.shop.app.web
---solution
com.shop.app
---explain
Scanning covers the main class's package and its sub-packages, so `com.shop.app` or any `com.shop.app.*` works. Alternatively, move the main class up to `com.shop`.
:::

:::exercise
id: si-skip-tests
level: 1
title: Package without tests
mode: answer
---
Write the Maven wrapper command that deletes old build output and builds the jar **without running tests**.
---answer
./mvnw clean package -DskipTests
---answer
./mvnw clean package -Dmaven.test.skip=true
---solution
./mvnw clean package -DskipTests
:::
