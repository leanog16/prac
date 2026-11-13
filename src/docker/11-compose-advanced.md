---
id: docker-compose-adv
title: Compose for real projects
summary: Override files and -f stacking, profiles for optional services, secrets as files, resource limits and hardening in Compose, reaching the host with host.docker.internal, compose watch for live development, and one Compose file across dev, CI and prod.
minutes: 35
---
## One app, several environments

A real project runs the same services in different shapes: on your laptop with live-reload and a debug UI, in CI with a throwaway database, and in production with limits, secrets and no source mounts. Copying `compose.yaml` three times means three files drifting apart. Compose has better tools: **override files**, **profiles** and **variables**.

## Override files

When you run `docker compose up` with no `-f`, Compose reads `compose.yaml` **and then**, if it exists, `compose.override.yaml`, merging the second on top of the first:

```yaml title=compose.yaml
services:
  api:
    image: ghcr.io/acme/api:${TAG:-latest}
    environment:
      LOG_LEVEL: info
    ports:
      - "8000:8000"
```

```yaml title=compose.override.yaml
services:
  api:
    build: .
    environment:
      LOG_LEVEL: debug
    volumes:
      - ./:/app
```

The merge rules:

- **Single values** (`image`, `command`, `restart`) are **replaced** by the later file.
- **Maps** (`environment`, `labels`) are **merged key by key**; the later file wins on conflicts.
- **Lists** (`ports`, `volumes`, `expose`) are **combined**.

So the base file holds what's true everywhere, the override holds dev-only conveniences, and Git-committing both keeps every developer's setup identical. For other environments, name the files explicitly. `-f` disables the automatic override, and the files merge left to right:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d
docker compose -f compose.yaml -f compose.prod.yaml config   # print the merged result
```

> [!tip] Check before you run
> `docker compose config` prints the fully merged, variable-substituted file. It's the fastest way to debug "why isn't my override applied?".

## Profiles: optional services

Some services only matter sometimes: an admin UI, a mail catcher, a load generator, a migration job. Give them a `profiles` list and they **don't start** unless that profile is active:

```yaml
services:
  api:
    image: nginx:alpine
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: devpass
  adminer:
    image: adminer
    ports:
      - "8081:8080"
    profiles: [debug]
  seed:
    image: alpine
    command: echo seeding
    profiles: [tools]
```

```bash
docker compose up -d                      # api and db only
docker compose --profile debug up -d      # plus adminer
COMPOSE_PROFILES=debug,tools docker compose up -d
docker compose up -d adminer              # naming a service enables its profile
```

Services **without** `profiles` always start.

## Secrets as files

Environment variables leak: they show up in `docker inspect`, in crash dumps, and in child processes. Compose **secrets** mount a value as a file under `/run/secrets/`, readable only inside that service:

```yaml
services:
  api:
    image: ghcr.io/acme/api:1.4.2
    environment:
      DB_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
secrets:
  db_password:
    file: ./secrets/db_password.txt     # keep this path in .gitignore
```

Your app reads the file at startup. Many official images (postgres, mysql, mariadb) already accept a `*_FILE` variant of their password variables for exactly this reason. A secret can also come from the host environment: `environment: DB_PASSWORD` instead of `file:`.

## Limits and hardening in Compose

Everything from the previous lesson has a Compose key:

```yaml
services:
  api:
    image: ghcr.io/acme/api:1.4.2
    restart: unless-stopped
    user: "10001:10001"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
```

`deploy.resources.limits` is the modern form; the older `mem_limit:`/`cpus:` service keys still work.

## Reaching the host from a container

`localhost` inside a container is the container itself. To call something running **on the host** (a database you didn't containerize, an IDE debugger), use the special name **`host.docker.internal`**. Docker Desktop provides it automatically; on Linux, map it yourself:

```yaml
services:
  api:
    image: ghcr.io/acme/api:1.4.2
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

`extra_hosts` adds lines to the container's `/etc/hosts`; `host-gateway` is replaced by the host's IP on the Docker bridge. The host service must listen on an address the bridge can reach, not only on 127.0.0.1.

## compose watch: live development

Bind-mounting your source works, but it's slow on macOS/Windows and mounts too much. `develop.watch` tells Compose to react to file changes itself:

```yaml
services:
  api:
    build: .
    ports:
      - "8000:8000"
    develop:
      watch:
        - action: sync            # copy changed files into the running container
          path: ./app
          target: /app/app
        - action: rebuild         # dependencies changed: rebuild the image
          path: requirements.txt
        - action: sync+restart    # config changed: copy, then restart the process
          path: ./config
          target: /app/config
```

```bash
docker compose watch       # or: docker compose up --watch
```

Pair `sync` with a dev server that reloads by itself (`uvicorn --reload`, `spring-boot-devtools`, `nodemon`).

## Day-to-day commands worth knowing

| Command | Use |
|---|---|
| `docker compose run --rm api pytest` | one-off command in a **new** container of a service (tests, migrations) |
| `docker compose exec db psql -U postgres` | command in the **running** container |
| `docker compose logs -f --tail 50 api` | follow one service's logs |
| `docker compose up -d --build api` | rebuild and recreate just one service |
| `docker compose pull && docker compose up -d` | update to newer image tags |
| `docker compose down -v` | stop and delete containers, networks **and named volumes** (careful) |
| `docker compose ps --format json` | machine-readable status for scripts |

:::quiz
q: `compose.yaml` sets `LOG_LEVEL: info` and `compose.override.yaml` sets `LOG_LEVEL: debug` for the same service. Which applies after `docker compose up`?
+ debug, because the override file is merged on top
- info, because the base file always wins
- both, as a list
- Compose errors on the conflict
why: Maps merge key by key and the later file wins. The override file is loaded automatically after the base file.
:::

:::quiz
q: Base file has `ports: ["8000:8000"]`, override has `ports: ["5678:5678"]`. What does the merged service publish?
- only 5678
- only 8000
+ both 8000 and 5678
- neither; lists can't be overridden
why: Lists like ports and volumes are combined, not replaced.
:::

:::quiz
q: A service declares `profiles: [debug]`. When does `docker compose up -d` start it?
- always
+ only when the debug profile is active (`--profile debug` or `COMPOSE_PROFILES=debug`), or the service is named explicitly
- only in production
- never; profiles are for `docker compose run` only
why: Profiled services are opt-in. Services without profiles always start.
:::

:::quiz
q: Where does a Compose secret named `api_key` appear inside the container?
- as the environment variable `API_KEY`
+ as the file `/run/secrets/api_key`
- in `/etc/secrets.env`
- in the image's labels
why: Secrets are mounted as files, which keeps them out of `docker inspect` and the process environment.
:::

:::exercise
id: dca-override
level: 2
title: A dev override
mode: file
file: compose.override.yaml
cwd: /home/student/site
setup: printf 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n    environment:\n      MODE: prod\n' > compose.yaml
---run
docker compose up -d >/dev/null 2>&1
docker exec site-web-1 printenv MODE
docker inspect -f '{{range .Mounts}}{{.Destination}}{{end}}' site-web-1
---
`~/site/compose.yaml` defines `web` with `MODE: prod`. Write `compose.override.yaml` so that during development `web` gets `MODE: dev` **and** bind-mounts the current directory onto `/usr/share/nginx/html`. Don't repeat the image or ports.
---solution
services:
  web:
    environment:
      MODE: dev
    volumes:
      - ./:/usr/share/nginx/html
:::

:::exercise
id: dca-profile
level: 2
title: An opt-in admin UI
mode: file
file: compose.yaml
cwd: /home/student/site
---run
docker compose up -d >/dev/null 2>&1
docker compose ps --format '{{.Service}}'
echo ---
docker compose --profile debug up -d >/dev/null 2>&1
docker compose --profile debug ps --format '{{.Service}}' | sort
---
Write a `compose.yaml` with two services: `web` (`nginx:alpine`, port `8080`) that always starts, and `adminer` (`adminer`, host port `8081` to container `8080`) that only starts when the **`debug`** profile is active.
---solution
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
  adminer:
    image: adminer
    ports:
      - "8081:8080"
    profiles: [debug]
:::

:::exercise
id: dca-secret
level: 3
title: Password as a file
mode: file
file: compose.yaml
cwd: /home/student/site
setup: echo 'S3cure!' > db_password.txt
---run
docker compose up -d >/dev/null 2>&1
docker exec site-db-1 cat /run/secrets/db_password
docker exec site-db-1 printenv POSTGRES_PASSWORD_FILE
---
`~/site/db_password.txt` holds the database password. Write a `compose.yaml` with a service `db` (`postgres:16`) that receives it as a Compose **secret** named `db_password`, and sets `POSTGRES_PASSWORD_FILE` to the path where that secret appears.
---hint
Top-level `secrets: { db_password: { file: ./db_password.txt } }`, and `secrets: [db_password]` on the service.
---solution
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
secrets:
  db_password:
    file: ./db_password.txt
:::

:::exercise
id: dca-limits
level: 3
title: Production-grade service
mode: file
file: compose.yaml
cwd: /home/student/site
---run
docker compose up -d >/dev/null 2>&1
docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.RestartPolicy.Name}}' site-web-1
---
Write a `compose.yaml` with a service `web` (`nginx:alpine`, port `8080`) that restarts `unless-stopped`, has a **read-only** root filesystem with a tmpfs at `/tmp`, drops **all** capabilities, and is limited to `0.5` CPUs and `256M` of memory using `deploy.resources.limits`.
---solution
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
:::

:::exercise
id: dca-prod-file
level: 3
title: Stack the prod file
compare: verify
cwd: /home/student/site
setup: printf 'services:\n  web:\n    image: nginx:alpine\n    environment:\n      MODE: base\n' > compose.yaml; printf 'services:\n  web:\n    environment:\n      MODE: dev\n' > compose.override.yaml; printf 'services:\n  web:\n    environment:\n      MODE: prod\n    ports:\n      - "80:80"\n' > compose.prod.yaml
---
`~/site` has `compose.yaml`, `compose.override.yaml` (dev) and `compose.prod.yaml`. Start the stack in the background using the **base and prod** files only, so the dev override is **not** applied.
---verify
docker exec site-web-1 printenv MODE
docker compose -f compose.yaml -f compose.prod.yaml ps --format '{{.Service}} {{.Ports}}'
---solution
docker compose -f compose.yaml -f compose.prod.yaml up -d
:::

:::exercise
id: dca-host
level: 2
title: Call the host
mode: code
lang: yaml
file: compose.yaml
---
On Linux, the `api` service must reach a database running directly on the host via the name `host.docker.internal`. Add what's needed.
---starter
services:
  api:
    image: ghcr.io/acme/api:1.4.2
    environment:
      DATABASE_HOST: host.docker.internal
---rule
^\s+extra_hosts:
`extra_hosts:` on the service
---rule
host\.docker\.internal:host-gateway
Map `host.docker.internal` to `host-gateway`
---solution
services:
  api:
    image: ghcr.io/acme/api:1.4.2
    environment:
      DATABASE_HOST: host.docker.internal
    extra_hosts:
      - "host.docker.internal:host-gateway"
:::

:::exercise
id: dca-watch
level: 3
title: Live sync, rebuild on deps
mode: code
lang: yaml
file: compose.yaml
---
Add a `develop.watch` section to `api` with two rules: **sync** `./app` to `/code/app`, and **rebuild** when `requirements.txt` changes.
---starter
services:
  api:
    build: .
    ports:
      - "8000:8000"
---rule
^\s+develop:\s*\n\s+watch:
`develop:` → `watch:`
---rule
action:\s*sync\s*\n\s+path:\s*\./app\s*\n\s+target:\s*/code/app|path:\s*\./app\s*\n\s+target:\s*/code/app\s*\n\s+-?\s*action:\s*sync|action:\s*sync[\s\S]{0,40}path:\s*\./app[\s\S]{0,40}target:\s*/code/app
Sync `./app` → `/code/app`
---rule
action:\s*rebuild\s*\n\s+path:\s*\.?/?requirements\.txt
Rebuild on `requirements.txt`
---solution
services:
  api:
    build: .
    ports:
      - "8000:8000"
    develop:
      watch:
        - action: sync
          path: ./app
          target: /code/app
        - action: rebuild
          path: requirements.txt
:::

:::exercise
id: dca-run-tests
level: 2
title: One-off vs running
mode: answer
---
The `api` service is running. You want to run `pytest` in a **fresh, throwaway** container of that service, not inside the running one. Which command? (Answer with the full command.)
---answer
docker compose run --rm api pytest
---solution
docker compose run --rm api pytest
---explain
`run` creates a new container for the service (and removes it with `--rm`); `exec` would run inside the existing one.
:::
