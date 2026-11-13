---
id: docker-compose
title: Docker Compose
summary: Describing multi-container apps in compose.yaml — services, build vs image, ports, environment and .env files, volumes, networks and service DNS, depends_on — and the up/ps/logs/exec/down workflow.
minutes: 40
---
## Why Compose

A real app is several containers: an API, a database, a cache, maybe a worker. Starting them with long `docker run` commands (network, volumes, env vars, ports, the right order) is error-prone. **Compose** describes the whole application in one YAML file and manages it as a unit.

```yaml title=compose.yaml
services:
  api:
    build: ./api
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://app:secret@db:5432/appdb
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## What Compose does for you

- Creates a **network** `<project>_default` and attaches every service, so services reach each other **by service name** (`db:5432` above).
- Creates named volumes declared under top-level `volumes:` as `<project>_<name>`.
- Builds images for services with `build:` (tagged `<project>-<service>`).
- Starts containers in **dependency order** (`depends_on`), named `<project>-<service>-1`.

The **project name** defaults to the directory name.

## Service keys you'll use

| Key | Meaning | `docker run` equivalent |
|---|---|---|
| `image: postgres:16` | use an image | `IMAGE` |
| `build: ./api` | build from a directory with a Dockerfile (or `{context, dockerfile, args}`) | `docker build` |
| `ports: ["8080:80"]` | publish ports (quote them!) | `-p` |
| `environment:` | map `KEY: value` or list `- KEY=value` | `-e` |
| `env_file: .env.app` | load variables from a file | `--env-file` |
| `volumes:` | `name:/path` (named) or `./dir:/path` (bind) | `-v` |
| `depends_on: [db]` | start order (add `condition: service_healthy` to wait for a healthcheck) | — |
| `command:` | override CMD | args after image |
| `restart: unless-stopped` | restart policy | `--restart` |
| `healthcheck:` | test / interval / retries | `--health-cmd` |
| `networks:` | custom networks | `--network` |

> [!warn] YAML gotchas
> Indentation is structure (spaces only, no tabs). Quote port mappings: unquoted `22:22` can be parsed as a base-60 number by YAML 1.1 parsers. Lists use `- item`; maps use `key: value` with a space after the colon.

## The workflow

| Command | Does |
|---|---|
| `docker compose up -d` | build (if needed), create and start everything in the background |
| `docker compose up -d --build` | rebuild images first |
| `docker compose ps` | the project's containers |
| `docker compose logs [-f] [service]` | aggregated logs |
| `docker compose exec SERVICE CMD` | run a command in a service's container |
| `docker compose stop` / `start` | stop/start without removing |
| `docker compose down` | stop and remove containers and the network |
| `docker compose down -v` | …and remove the named volumes (**data loss**) |

```bash run
mkdir web-demo && cd web-demo
cat > compose.yaml <<'EOF'
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
  cache:
    image: redis:7-alpine
EOF
docker compose up -d
docker compose ps
docker compose exec web ping -c 1 cache
curl -s localhost:8080 | grep '<title>'
docker compose down
```

## Variables and .env

Compose substitutes `${VAR}` in the YAML from your shell environment and from a `.env` file next to `compose.yaml`. `${VAR:-default}` supplies a fallback.

```yaml
services:
  web:
    image: nginx:${NGINX_TAG:-alpine}
    ports:
      - "${WEB_PORT:-8080}:80"
```

Keep `.env` out of git when it holds secrets, and commit an `.env.example` instead.

## depends_on and readiness

`depends_on` controls **start order**, not readiness: "db's container started" doesn't mean "Postgres is accepting connections". Production-grade files add a healthcheck and wait for it:

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5
```

Even then, apps should retry their database connection on startup.

:::quiz
q: In a compose project in directory `shop`, what is the container name for service `web`?
- web
- shop_web
+ shop-web-1
- web-shop-1
why: <project>-<service>-<index>, where the project defaults to the directory name.
:::

:::quiz
q: How does the api service connect to the postgres service named db?
+ host db, port 5432 (the container port)
- localhost:5432
- the host port from db's ports mapping
- by IP address only
why: Compose puts services on a shared network with DNS by service name.
:::

:::quiz
q: What does `docker compose down` remove?
- only the containers
+ containers and the default network (volumes only with -v)
- everything including images and volumes
- nothing; it only stops containers
why: Named volumes are kept unless you pass -v, which protects your data.
:::

:::quiz
q: `depends_on: [db]` guarantees that…
- the database is ready to accept connections
+ the db container is started before the dependent service
- db restarts when the api fails
- the services share volumes
why: Start order only. Use condition: service_healthy with a healthcheck for readiness.
:::

:::quiz
q: Where does Compose read `${WEB_PORT}` from?
- only from the Dockerfile
+ the shell environment and a .env file in the project directory
- docker run -e flags
- the image's ENV instructions
why: Interpolation happens when Compose parses the file, using your environment and .env.
:::

:::exercise
id: dco-single
level: 1
title: Your first compose.yaml
mode: file
file: compose.yaml
cwd: /home/student/site
---run
docker compose up -d >/dev/null 2>&1
docker compose ps --format '{{.Service}} {{.Ports}}'
curl -s localhost:8080 | grep -o '<title>.*</title>'
---
In `~/site`, write a `compose.yaml` with one service `web` using `nginx:alpine`, published on host port `8080`.
---solution
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
:::

:::exercise
id: dco-bind
level: 2
title: Serve the site with a bind mount
mode: file
file: compose.yaml
cwd: /home/student/site
---run
docker compose up -d >/dev/null 2>&1
curl -s localhost:8080/about.html | grep -o '<h1>.*</h1>'
docker compose ps --format '{{.Name}}'
---
In `~/site`, write a `compose.yaml` with a service `web` (`nginx:alpine`, port `8080`) that bind-mounts the current directory (`.`) read-only onto `/usr/share/nginx/html`.
---solution
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./:/usr/share/nginx/html:ro
:::

:::exercise
id: dco-build
level: 2
title: Build and run the API
mode: file
file: compose.yaml
cwd: /home/student/fastapi-app
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile
---run
docker compose up -d >/dev/null 2>&1
curl -s localhost:8000/health; echo
docker compose ps --format '{{.Service}} {{.Image}}'
---
`~/fastapi-app` has a working Dockerfile. Write a `compose.yaml` with a service `api` that **builds** from the current directory and publishes port `8000`.
---solution
services:
  api:
    build: .
    ports:
      - "8000:8000"
:::

:::exercise
id: dco-postgres
level: 2
title: A database service with storage
mode: file
file: compose.yaml
cwd: /home/student
setup: mkdir -p ~/dbproj
---run
cd ~/dbproj
cp ~/compose.yaml .
docker compose up -d >/dev/null 2>&1
docker compose ps --format '{{.Service}} {{.Status}}'
docker volume ls --format '{{.Name}}'
docker compose exec db env | grep POSTGRES_DB
---
Write a `compose.yaml` with a service `db` using `postgres:16-alpine`, environment variables `POSTGRES_PASSWORD=secret` and `POSTGRES_DB=appdb`, and a named volume `pgdata` mounted at `/var/lib/postgresql/data` (declare the volume at the top level). The grader runs it in a project directory called `dbproj`.
---solution
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
:::

:::exercise
id: dco-stack
level: 3
title: API + database + cache
mode: file
file: compose.yaml
cwd: /home/student/fastapi-app
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile
---run
docker compose up -d >/dev/null 2>&1
docker compose ps --format '{{.Service}} {{.Status}} {{.Ports}}'
docker compose exec api env | grep -E 'DATABASE_URL|REDIS_URL' | sort
docker compose exec api ping -c 1 db > /dev/null && echo "api -> db ok"
docker compose exec api ping -c 1 cache > /dev/null && echo "api -> cache ok"
---
In `~/fastapi-app`, write a `compose.yaml` with three services:

- `api`: built from `.`, port `8000:8000`, env `DATABASE_URL=postgresql://app:secret@db:5432/appdb` and `REDIS_URL=redis://cache:6379/0`, depends on `db` and `cache`
- `db`: `postgres:16-alpine` with `POSTGRES_USER=app`, `POSTGRES_PASSWORD=secret`, `POSTGRES_DB=appdb`
- `cache`: `redis:7-alpine`
---solution
services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://app:secret@db:5432/appdb
      REDIS_URL: redis://cache:6379/0
    depends_on:
      - db
      - cache
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
  cache:
    image: redis:7-alpine
:::

:::exercise
id: dco-env
level: 3
title: Port from .env
mode: file
file: compose.yaml
cwd: /home/student/site
setup: echo 'WEB_PORT=8085' > /home/student/site/.env
---run
docker compose up -d >/dev/null 2>&1
docker compose ps --format '{{.Ports}}'
---
`~/site/.env` contains `WEB_PORT=8085`. Write a `compose.yaml` whose `web` service (`nginx:alpine`) publishes container port 80 on host port `${WEB_PORT}`, falling back to `8080` if the variable isn't set.
---solution
services:
  web:
    image: nginx:alpine
    ports:
      - "${WEB_PORT:-8080}:80"
:::

:::exercise
id: dco-down
level: 2
title: Tear it all down
compare: verify
cwd: /home/student/fastapi-app
setup: printf 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n  cache:\n    image: redis:7-alpine\nvolumes:\n  pgdata:\n' > compose.yaml && docker compose up -d >/dev/null 2>&1
---
A compose project is running in `~/fastapi-app` with a named volume. Stop and remove everything, **including** the volumes.
---verify
docker ps -a -q | wc -l
docker volume ls -q | wc -l
docker network ls --format '{{.Name}}' | grep -c fastapi || true
---solution
docker compose down -v
:::

:::exercise
id: dco-logs
level: 2
title: One service's logs
cwd: /home/student/fastapi-app
setup: printf 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n  cache:\n    image: redis:7-alpine\n' > compose.yaml && docker compose up -d >/dev/null 2>&1
---
A compose project is running. Show the logs of only the `cache` service.
---solution
docker compose logs cache
:::

:::exercise
id: dco-fix-yaml
level: 3
title: Fix the broken file
mode: file
file: compose.yaml
cwd: /home/student/site
---starter
services:
  web:
   image: nginx:alpine
    ports:
    - 8080:80
  enviroment:
      - MODE=dev
---run
docker compose up -d >/dev/null && docker compose ps --format '{{.Service}} {{.Ports}}'
docker compose exec web env | grep MODE
---
The starter `compose.yaml` has indentation problems and a misplaced, misspelled key. Fix it so that the `web` service runs `nginx:alpine` on host port `8080` with the environment variable `MODE=dev`.
---hint
All of `web`'s keys need the same indentation. `environment` belongs inside `web` and is spelled with an "n" before "ment".
---solution
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    environment:
      - MODE=dev
:::

:::exercise
id: dco-name
level: 2
title: Predict the container name
mode: answer
---
A `compose.yaml` in the directory `inventory-api` defines a service called `worker`. What's the name of the container `docker compose up` creates?
---answer
inventory-api-worker-1
---solution
inventory-api-worker-1
:::

:::exercise
id: dco-exec
level: 2
title: Run a command in a service
cwd: /home/student/fastapi-app
setup: printf 'services:\n  cache:\n    image: redis:7-alpine\n' > compose.yaml && docker compose up -d >/dev/null 2>&1
---
A compose project with a `cache` service (Redis) is running. Using `docker compose exec`, set the key `visits` to `41` and then increment it with `redis-cli`, so the output ends with `(integer) 42`.
---solution
docker compose exec cache redis-cli SET visits 41
docker compose exec cache redis-cli INCR visits
:::
