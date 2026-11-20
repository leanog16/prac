---
id: docker-apps
title: Production images for FastAPI & Spring
summary: Putting it together for real services — pinned bases, dependency caching, non-root users, healthchecks, configuration through environment variables, profiles, and composing apps with databases.
minutes: 35
---
> [!project] Taskboard, step 9: the production image
> The development image works, but it runs as root, has no healthcheck and carries whatever the build left behind. This step writes the image you'd actually ship.

## A production checklist

| Practice | Why |
|---|---|
| Pin base images (`python:3.12-slim`, `eclipse-temurin:21-jre`) | reproducible builds |
| Dependencies before source | fast, cached rebuilds |
| `.dockerignore` | no secrets, no junk, stable cache |
| Multi-stage for compiled apps | small images without build tools |
| Run as a non-root `USER` | limits the blast radius of a compromise |
| `HEALTHCHECK` (or orchestrator probes) | detect a hung app, not just a dead one |
| Exec-form CMD/ENTRYPOINT | proper signal handling, graceful shutdown |
| Config via environment variables | one image for dev, staging and prod (the "12-factor" approach) |
| One process per container | simple logs, scaling and restarts |
| Log to stdout/stderr | `docker logs` and log collectors just work |

## FastAPI, production style

```dockerfile title=fastapi-app/Dockerfile
FROM python:3.12-slim
WORKDIR /app

# curl is needed by the HEALTHCHECK (slim images don't include it)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`docker ps` shows `(healthy)` or `(unhealthy)` next to the uptime once the check runs. A classic mistake is a `curl`-based healthcheck in an image that doesn't have curl: the check fails forever and the container is marked unhealthy even though the app is fine.

```bash run
cd fastapi-app
printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nHEALTHCHECK CMD curl -f http://localhost:8000/health || exit 1\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile
docker build -q -t api . > /dev/null
docker run -d --name api -p 8000:8000 api > /dev/null
docker ps --format '{{.Names}}: {{.Status}}'
curl -s localhost:8000/health
```

Unhealthy, yet the endpoint works from the host. The check runs **inside** the container, where `curl` doesn't exist in the slim image.

## Spring Boot, production style

```dockerfile title=spring-app/Dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --create-home spring
COPY --from=build /src/target/*.jar app.jar
USER spring
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Spring Boot reads configuration from environment variables through **relaxed binding**: `server.port` ← `SERVER_PORT`, `spring.datasource.url` ← `SPRING_DATASOURCE_URL`, `spring.profiles.active` ← `SPRING_PROFILES_ACTIVE`. So the same image runs anywhere:

```bash run
cd spring-app
printf 'FROM maven:3.9-eclipse-temurin-21 AS build\nWORKDIR /src\nCOPY pom.xml .\nCOPY src ./src\nRUN mvn -q package -DskipTests\n\nFROM eclipse-temurin:21-jre\nWORKDIR /app\nCOPY --from=build /src/target/*.jar app.jar\nENTRYPOINT ["java", "-jar", "app.jar"]\n' > Dockerfile
docker build -q -t demo . > /dev/null
docker run -d --name demo -p 9090:9090 -e SERVER_PORT=9090 -e SPRING_PROFILES_ACTIVE=prod demo > /dev/null
docker logs demo | grep -E 'profile|Tomcat started'
curl -s "localhost:9090/hello?name=prod"
```

## Composing an app with its database

```yaml title=compose.yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/demo
      SPRING_DATASOURCE_USERNAME: demo
      SPRING_DATASOURCE_PASSWORD: ${DB_PASSWORD:-devpass}
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: demo
      POSTGRES_USER: demo
      POSTGRES_PASSWORD: ${DB_PASSWORD:-devpass}
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

## Worked example: from dev image to production image

```dockerfile title=taskboard/Dockerfile
# ---- build stage: compile wheels with full tooling ----
FROM python:3.12-slim AS build
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

# ---- runtime stage: only what's needed to run ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels
COPY . .
RUN useradd --create-home --uid 10001 app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
```

What each improvement buys:

| Change | Benefit |
|---|---|
| multi-stage build | compilers stay in the build stage; the runtime image is smaller with fewer CVEs |
| `PYTHONUNBUFFERED=1` | logs appear immediately in `docker logs` instead of being buffered |
| non-root `USER app` | a compromised app can't modify system files or easily escalate |
| `HEALTHCHECK` | `docker ps` shows `healthy`/`unhealthy`; orchestrators can replace broken containers |
| `--workers 2 --proxy-headers` | uses more than one CPU core; correct client IPs behind a load balancer |

The healthcheck uses Python's standard library because `curl` isn't installed in the slim image. Adding curl just for a healthcheck would grow the image and the attack surface.

> [!plain] In plain English
> A multi-stage Dockerfile is two recipes in one: the first builds things, the second copies only the finished results into a clean, small image.

## Common mistakes

> [!mistake] `USER` before files are in place
> `USER app` followed by `RUN pip install` fails or installs into the wrong place, because the non-root user can't write to system directories. Install as root, then switch user near the end.

:::quiz
q: A container's HEALTHCHECK runs `curl -f http://localhost:8000/health` but the image has no curl. What does docker ps show?
+ (unhealthy), even though the app works
- (healthy), because the app responds
- nothing; healthchecks need Compose
- the container exits
why: The check command fails inside the container, so every check fails.
:::

:::quiz
q: Which environment variable sets Spring Boot's `server.port`?
- SERVER-PORT
- server_port
+ SERVER_PORT
- SPRING_PORT
why: Relaxed binding: uppercase, dots become underscores.
:::

:::quiz
q: Why switch to a non-root USER in the runtime stage?
- Root can't run Java
+ To limit what an attacker can do if the app is compromised
- Non-root images are smaller
- Docker requires it
why: Defense in depth. The app rarely needs root privileges at runtime.
:::

:::quiz
q: The "12-factor" approach to config in containers is…
- bake a config file per environment into separate images
+ build one image and supply environment-specific config through environment variables at run time
- read config from the Dockerfile
- use a different base image per environment
why: One immutable artifact promoted through environments, configured at deploy time.
:::

:::exercise
id: da-health
level: 3
title: A healthcheck that works
mode: file
file: Dockerfile
cwd: /home/student/fastapi-app
---run
docker build -q -t api . >/dev/null
docker run -d --name api -p 8000:8000 api >/dev/null
docker ps --format '{{.Names}}: {{.Status}}'
---
Write a Dockerfile for `~/fastapi-app` (base `python:3.12-slim`, workdir `/app`, usual requirements-first install, uvicorn on `0.0.0.0:8000`) with a `HEALTHCHECK` that runs `curl -f http://localhost:8000/health || exit 1`. The container must report **healthy**, so make sure curl exists in the image.
---hint
`RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*`
---solution
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
HEALTHCHECK CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: da-fastapi-nonroot
level: 3
title: FastAPI as a non-root user
mode: file
file: Dockerfile
cwd: /home/student/fastapi-app
---run
docker build -q -t api . >/dev/null
docker run -d --name api -p 8000:8000 api >/dev/null
curl -s localhost:8000/; echo
docker exec api whoami
---
Write a Dockerfile for `~/fastapi-app` (slim base, workdir `/app`, requirements first, uvicorn on `0.0.0.0:8000`) that creates a user `appuser` and runs the app as that user.
---solution
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m appuser
USER appuser
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: da-spring-port
level: 3
title: Configure Spring through the environment
cwd: /home/student/spring-app
setup: printf 'FROM maven:3.9-eclipse-temurin-21 AS build\nWORKDIR /src\nCOPY pom.xml .\nCOPY src ./src\nRUN mvn -q package -DskipTests\n\nFROM eclipse-temurin:21-jre\nWORKDIR /app\nCOPY --from=build /src/target/*.jar app.jar\nENTRYPOINT ["java", "-jar", "app.jar"]\n' > Dockerfile && docker build -q -t demo . >/dev/null 2>&1
compare: verify
---
The `demo` image (Spring Boot, default port 8080) is built. Run it in the background as `demo` so that the app itself listens on port **9090** (set through an environment variable) and is reachable from the host on 9090, with the `prod` profile active.
---verify
curl -s "localhost:9090/hello?name=prod"; echo
docker logs demo | grep -o 'profile is active: "prod"'
---solution
docker run -d --name demo -p 9090:9090 -e SERVER_PORT=9090 -e SPRING_PROFILES_ACTIVE=prod demo
:::

:::exercise
id: da-spring-compose
level: 4
title: Spring Boot + Postgres with Compose
mode: file
file: compose.yaml
cwd: /home/student/spring-app
setup: printf 'FROM maven:3.9-eclipse-temurin-21 AS build\nWORKDIR /src\nCOPY pom.xml .\nCOPY src ./src\nRUN mvn -q package -DskipTests\n\nFROM eclipse-temurin:21-jre\nWORKDIR /app\nCOPY --from=build /src/target/*.jar app.jar\nENTRYPOINT ["java", "-jar", "app.jar"]\n' > Dockerfile
---run
docker compose up -d >/dev/null 2>&1
docker compose ps --format '{{.Service}} {{.Status}}'
curl -s localhost:8080/actuator/health; echo
docker compose exec app env | grep SPRING_DATASOURCE_URL
docker volume ls --format '{{.Name}}'
---
In `~/spring-app` (which has a working Dockerfile), write a `compose.yaml` with:

- `app`: built from `.`, port `8080:8080`, `SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/demo`, depends on `db`
- `db`: `postgres:16-alpine` with `POSTGRES_DB=demo`, `POSTGRES_USER=demo`, `POSTGRES_PASSWORD=devpass`, and a named volume `pgdata` at `/var/lib/postgresql/data`
---solution
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/demo
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: demo
      POSTGRES_USER: demo
      POSTGRES_PASSWORD: devpass
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
:::

:::exercise
id: da-spring-full
level: 4
title: The full production Spring image
mode: file
file: Dockerfile
cwd: /home/student/spring-app
---run
docker build -q -t demo . >/dev/null
docker run -d --name demo -p 8080:8080 demo >/dev/null
curl -s localhost:8080/hello; echo
docker exec demo whoami
docker images demo --format '{{.Size}}'
docker inspect -f '{{json .Config.ExposedPorts}}' demo
---
Write a multi-stage Dockerfile for `~/spring-app`: build with `maven:3.9-eclipse-temurin-21` (`mvn -q package -DskipTests`), run on `eclipse-temurin:21-jre` from `/app` as `app.jar`, as a non-root user named `spring` (created with `useradd -m`), documenting port 8080, with `java -jar app.jar` as the ENTRYPOINT.
---solution
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd -m spring
COPY --from=build /src/target/*.jar app.jar
USER spring
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
:::

:::exercise
id: da-env-name
level: 2
title: Relaxed binding
mode: answer
---
Which environment variable overrides the Spring property `spring.datasource.password`?
---answer
SPRING_DATASOURCE_PASSWORD
---solution
SPRING_DATASOURCE_PASSWORD
:::

:::exercise
id: da-uvicorn-workers
level: 2
title: Same image, different config
mode: answer
---
One FastAPI image is deployed to staging and production. The production database URL should come from where: the Dockerfile, the source code, or the environment at run time? (Answer with one word.)
---answer
environment
---answer
the environment
---answer
env
---solution
environment
:::

:::exercise
id: proj-dk-09-prod
level: 4
title: "Project 9: Taskboard's production Dockerfile"
mode: file
file: Dockerfile
cwd: /home/student/taskboard
path: Dockerfile
---run
docker build -q -t taskboard:prod . >/dev/null
docker run -d --name api -p 8000:8000 taskboard:prod >/dev/null
curl -s localhost:8000/health; echo
docker inspect -f '{{.Config.User}} {{.Config.Env}}' api | grep -o 'app\|PYTHONUNBUFFERED=1' | sort -u
docker inspect taskboard:prod | grep -c urllib
---
Write a production Dockerfile for `~/taskboard`: from `python:3.12-slim`; set `PYTHONUNBUFFERED=1`; work in `/app`; install `requirements.txt` with pip before copying the source; copy the source; create a user `app` with `useradd --create-home app` and switch to it; add a `HEALTHCHECK` that fetches `http://localhost:8000/health` with Python's `urllib`; start uvicorn on `0.0.0.0:8000` in exec form.
---solution
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: proj-dk-09-multistage
level: 4
title: "Project 9b: a multi-stage build"
mode: code
lang: dockerfile
file: Dockerfile
path: Dockerfile
---
Rewrite as a two-stage build: a `build` stage (`FROM python:3.12-slim AS build`) that runs `pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt`, and a runtime stage that copies `/wheels` **from the build stage**, installs them, and copies the app. Keep the non-root user.
---starter
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home app
USER app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
---rule
^FROM\s+python:3\.12-slim\s+AS\s+build
A stage named `build`
---rule
pip\s+wheel\s+(?=[^\n]*--wheel-dir[ =]/wheels)(?=[^\n]*-r\s+requirements\.txt)
`pip wheel --wheel-dir /wheels -r requirements.txt`
---rule
COPY\s+--from=build\s+/wheels\s+/wheels
`COPY --from=build /wheels /wheels`
---rule
RUN\s+pip\s+install[^\n]*/wheels/\*
Install from the wheels
---rule
(FROM[\s\S]*){2}
Two stages
---rule
USER\s+app
Non-root user
---solution
FROM python:3.12-slim AS build
WORKDIR /build
COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels
COPY . .
RUN useradd --create-home app
USER app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::
