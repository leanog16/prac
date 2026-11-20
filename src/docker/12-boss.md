---
id: docker-boss
title: Boss round: troubleshooting
summary: Realistic broken setups to diagnose and fix — port clashes, containers that won't stay up, unreachable apps, bloated images, slow builds, leaked secrets, services that can't find each other.
minutes: 60
---
> [!project] Taskboard, final step: incident drills
> The team inherits a broken Taskboard setup. Each project exercise below is a realistic failure; diagnose it with the playbook, fix it, and prove the fix with output.

## A troubleshooting playbook

When something's wrong, work from the outside in:

| Symptom | First commands | Usual causes |
|---|---|---|
| Container not in `docker ps` | `docker ps -a`, `docker logs NAME` | main process exited: crash, missing env var, nothing to do (bash with no tty) |
| `port is already allocated` | `docker ps --format '{{.Names}} {{.Ports}}'` | another container (or host process) owns that host port |
| curl from host: connection reset | `docker logs NAME`, `docker port NAME` | app bound to 127.0.0.1, or `-p` maps to the wrong container port |
| curl from host: connection refused | `docker ps` | container not running, or no `-p` at all |
| Service can't reach another | `docker network inspect`, `docker exec A ping B` | not on the same user-defined network, wrong hostname, using the host port instead of the container port |
| `(unhealthy)` | `docker inspect -f '{{json .State.Health}}' NAME` | healthcheck tool missing (curl), wrong port/path |
| Image is huge | `docker history IMAGE`, `docker images` | full base image, build tools in the runtime image, caches left in layers |
| Every build reinstalls deps | read the Dockerfile order | source copied before the dependency install |
| Secrets in the image | `docker run --rm IMAGE ls -a /app`, `docker history` | missing `.dockerignore`, secrets in ENV/ARG |
| `unable to find user` | `docker inspect -f '{{.Config.User}}'` | `USER` set to a user that was never created |

Two more commands you'll need:

- `docker container prune -f` removes **every stopped container** at once (`-f` skips the confirmation). Running containers are left alone.
- A container needs a main process that keeps running. For a general-purpose box you only want to `docker exec` into, give it a command that never ends: `docker run -d --name box ubuntu sleep infinity`.

Each exercise below is set up broken. Diagnose first; the hints point at the right command.

## Worked example: diagnosing "the API is down"

Symptom: `curl localhost:8000/health` → `Connection refused`.

1. **Is the container running?** `docker ps` doesn't list `api`. → It exited.
2. **Why?** `docker ps -a` shows `Exited (1)`; `docker logs api` shows `Error loading ASGI app. Could not import module "app"`.
3. **Root cause**: the Dockerfile's `CMD` says `uvicorn app:app`, but the module is `main.py`.
4. **Fix and verify**: correct the CMD, rebuild, rerun, curl again.

Write the four steps down every time: **observe → hypothesize → confirm → fix and verify**. Jumping straight to "fix" usually means changing three things at once and not knowing which one mattered.

:::exercise
id: db-port-clash
level: 3
title: Port already allocated
compare: verify
setup: docker run -d --name web -p 8080:80 nginx >/dev/null 2>&1
---
A teammate's `web` container already uses host port 8080, and `docker run -d --name web2 -p 8080:80 nginx` fails. Start `web2` from `nginx` reachable on host port **8081** instead, without disturbing `web`.
---verify
docker ps --format '{{.Names}} {{.Ports}}' | sort
curl -s localhost:8081 | grep -o '<title>.*</title>'
---solution
docker run -d --name web2 -p 8081:80 nginx
:::

:::exercise
id: db-stay-up
level: 3
title: The container that won't stay up
compare: verify
setup: docker run -d --name worker ubuntu >/dev/null 2>&1
---
`docker run -d --name worker ubuntu` exits immediately. Replace it with a `worker` container from `ubuntu` that **keeps running** in the background (use `sleep infinity` as its command), so you can `docker exec` into it later.
---hint
Remove the old `worker` first; then pass a command after the image name.
---verify
docker ps --format '{{.Names}} {{.State}}'
docker exec worker cat /etc/os-release | head -1
---solution
docker rm worker
docker run -d --name worker ubuntu sleep infinity
:::

:::exercise
id: db-wrong-port
level: 3
title: Published, but to the wrong port
compare: verify
cwd: /home/student/fastapi-app
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir -r requirements.txt\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile && docker build -q -t api . >/dev/null 2>&1 && docker run -d --name api -p 8000:80 api >/dev/null 2>&1
---
The `api` container is running with `-p 8000:80`, but `curl localhost:8000` gets "connection reset". Find what port the app actually listens on (check the logs) and replace the container with one named `api` that's reachable at `localhost:8000`.
---verify
curl -s localhost:8000/health; echo
docker port api
---solution
docker logs api | tail -1
docker rm -f api
docker run -d --name api -p 8000:8000 api
:::

:::exercise
id: db-slim
level: 3
title: Put the image on a diet
mode: file
file: Dockerfile
cwd: /home/student/fastapi-app
---starter
FROM python:3.12
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
---run
printf '.env\n__pycache__/\ntests/\n' > .dockerignore
docker build -q -t api . >/dev/null
docker images api --format '{{.Size}}'
docker run -d -p 8000:8000 api >/dev/null && curl -s localhost:8000/health
---
This Dockerfile produces a ~1 GB image. Rewrite it to use `python:3.12-slim`, install dependencies with `--no-cache-dir` **before** copying the source, keeping the same uvicorn command. (The grader supplies a `.dockerignore`.)
---solution
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: db-secret
level: 3
title: A secret in the image
mode: file
file: .dockerignore
cwd: /home/student/fastapi-app
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD ["python", "-c", "print(1)"]\n' > ~/fastapi-app/Dockerfile
---run
docker build -q -t api . >/dev/null
docker run --rm api cat /app/.env 2>&1 | head -1
docker run --rm api ls -A /app
---
Security found `SECRET_KEY` inside the `api` image: `docker run --rm api cat /app/.env` prints it. Write a `.dockerignore` so `.env` (and while you're at it, `__pycache__/` and `tests/`) never reach the image.
---solution
.env
__pycache__/
tests/
:::

:::exercise
id: db-user-missing
level: 3
title: unable to find user
mode: file
file: Dockerfile
cwd: /home/student/hello
---starter
FROM python:3.12-slim
WORKDIR /app
COPY app.py .
USER appuser
CMD ["python", "app.py"]
---run
docker build -q -t hello . >/dev/null
docker run --rm hello
---
This image builds, but `docker run` fails with `unable to find user appuser`. Fix the Dockerfile so the app runs as `appuser`.
---hint
`USER` doesn't create the account. Add a `RUN useradd -m appuser` before it.
---solution
FROM python:3.12-slim
WORKDIR /app
COPY app.py .
RUN useradd -m appuser
USER appuser
CMD ["python", "app.py"]
:::

:::exercise
id: db-separate-networks
level: 4
title: Services that can't see each other
mode: file
file: compose.yaml
cwd: /home/student/fastapi-app
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir -r requirements.txt\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile
---starter
services:
  api:
    build: .
    ports:
      - "8000:8000"
    networks:
      - frontend
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    networks:
      - backend
networks:
  frontend:
  backend:
---run
docker compose up -d >/dev/null 2>&1
docker compose exec api ping -c 1 db > /dev/null && echo "api reaches db" || echo "api cannot reach db"
curl -s localhost:8000/health
---
The API can't resolve `db`. Fix the compose file so `api` can reach `db` (keep both custom networks; the API should be on both, the database only on `backend`).
---hint
A service can list several networks.
---solution
services:
  api:
    build: .
    ports:
      - "8000:8000"
    networks:
      - frontend
      - backend
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    networks:
      - backend
networks:
  frontend:
  backend:
:::

:::exercise
id: db-compose-db-crash
level: 3
title: The database keeps exiting
mode: file
file: compose.yaml
cwd: /home/student/fastapi-app
---starter
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: appdb
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
---run
docker compose up -d >/dev/null 2>&1
docker compose ps -a --format '{{.Service}} {{.Status}}'
docker compose logs db | tail -1
---
With this compose file, `db` exits right after starting. Read its logs (`docker compose logs db`) and fix the file. Use the password `secret`.
---solution
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: appdb
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
:::

:::exercise
id: db-cleanup
level: 2
title: Reclaim everything stopped
compare: verify
setup: docker run --name a alpine true >/dev/null 2>&1; docker run --name b alpine true >/dev/null 2>&1; docker run -d --name keep nginx >/dev/null 2>&1
---
Several stopped containers are lying around next to a running `keep`. Remove **all stopped containers** in one command, without a confirmation prompt.
---verify
docker ps -a --format '{{.Names}} {{.State}}'
---solution
docker container prune -f
:::

:::exercise
id: db-diagnose-answer
level: 2
title: Diagnose from the symptom
mode: answer
---
`curl localhost:8000` from your laptop says **Connection reset by peer**. `docker ps` shows the container `Up` with `0.0.0.0:8000->8000/tcp`, and its logs end with `Uvicorn running on http://127.0.0.1:8000`. What host address must uvicorn be told to bind to?
---answer
0.0.0.0
---solution
0.0.0.0
:::

:::exercise
id: db-multi-fix
level: 4
title: Three bugs, one Dockerfile
mode: file
file: Dockerfile
cwd: /home/student/fastapi-app
---starter
FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
HEALTHCHECK CMD curl -f http://localhost:8000/health || exit 1
CMD uvicorn main:app --port 8000
---run
printf '.env\n__pycache__/\ntests/\n' > .dockerignore
docker build -q -t api . >/dev/null
docker run -d --name api -p 8000:8000 api >/dev/null
curl -s localhost:8000/health; echo
docker ps --format '{{.Status}}'
echo "# edit" >> main.py
docker build -t api . | grep -c 'CACHED.*pip install'
---
This Dockerfile has three problems: the app is unreachable from the host, the container is reported **unhealthy**, and every code change reinstalls dependencies. Fix all three. Keep `python:3.12-slim`, use exec form for CMD, and install curl with apt in a single cleaned-up RUN.
---hint
Bind uvicorn to 0.0.0.0; install curl for the healthcheck; copy requirements and install before `COPY . .`.
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
id: proj-dk-12-wrong-module
level: 4
title: "Project 12: the API that won't start"
mode: file
file: Dockerfile
cwd: /home/student/taskboard
path: Dockerfile
---run
docker build -q -t taskboard . >/dev/null
docker run -d --name api -p 8000:8000 taskboard >/dev/null
curl -s localhost:8000/health; echo
---
This Dockerfile builds, but the container exits immediately and nothing answers on port 8000. Find **both** bugs (check `docker logs` after running it) and fix them.
---starter
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app:app", "--port", "8000"]
---hint
The module is `main.py`. And who can connect to a server bound to 127.0.0.1 inside a container?
---solution
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: proj-dk-12-db-host
level: 4
title: "Project 12b: the API can't find the database"
mode: file
file: compose.yaml
cwd: /home/student/taskboard
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile
path: compose.yaml
---run
docker compose up -d >/dev/null 2>&1
docker exec taskboard-api-1 printenv DATABASE_URL
docker compose ps --format '{{.Service}} {{.Ports}}' | sort
---
The compose file below connects the API to `localhost:5432` and publishes the database to the world. Fix it: the API must use the **db service name** in its URL, and `db` must **not** publish any port.
---starter
services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:devpass@localhost:5432/postgres
  db:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: devpass
---solution
services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:devpass@db:5432/postgres
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: devpass
:::

:::exercise
id: proj-dk-12-leak
level: 3
title: "Project 12c: the leaked secret"
compare: verify
cwd: /home/student/taskboard
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile
path: ops/docker/12-leak.sh
---
A security scan found `SECRET_KEY` inside the published Taskboard image. Add `.env` to a `.dockerignore` in `~/taskboard` (create the file), rebuild as `taskboard:fixed`, and confirm the file is gone by listing `/app` (with hidden files) in a throwaway container.
---verify
docker run --rm taskboard:fixed ls -a /app
---solution
echo ".env" > .dockerignore
docker build -t taskboard:fixed .
docker run --rm taskboard:fixed ls -a /app
:::
