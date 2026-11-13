## Containers

| Command | Does |
|---|---|
| `docker run -d --name web -p 8080:80 nginx` | run in background, publish host 8080 → container 80 |
| `docker run --rm -it alpine sh` | throwaway interactive shell |
| `docker run -e KEY=val --env-file .env IMAGE` | environment variables |
| `docker run -v data:/var/lib/x -v ./src:/app:ro IMAGE` | named volume / read-only bind mount |
| `docker ps` / `docker ps -a` | running / all containers |
| `docker logs -f --tail 50 web` | follow the last 50 log lines |
| `docker exec -it web sh` | shell inside a running container |
| `docker stop web` / `docker start web` / `docker rm -f web` | stop / start / force-remove |
| `docker inspect -f '{{.State.Status}}' web` | one field from the JSON |
| `docker port web` / `docker top web` / `docker stats --no-stream` | ports / processes / resource use |
| `docker cp web:/etc/nginx/nginx.conf .` | copy files out (or in) |

## Images

| Command | Does |
|---|---|
| `docker build -t app:1.2.0 .` | build from `./Dockerfile` |
| `docker build -f Dockerfile.prod --target runtime --build-arg V=1 .` | other file / stage / build arg |
| `docker images` / `docker history app:1.2.0` | list / layers and sizes |
| `docker tag app:1.2.0 ghcr.io/acme/app:1.2.0` | add a name |
| `docker push ghcr.io/acme/app:1.2.0` | upload to a registry |
| `docker save -o app.tar app:1.2.0` / `docker load -i app.tar` | move images as files |
| `docker image prune` / `docker system prune` / `docker system df` | clean up / see usage |
| `docker buildx build --platform linux/amd64,linux/arm64 -t … --push .` | multi-platform image |

## Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt     # deps before source = cache hits
COPY . .
RUN useradd --create-home app
USER app
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- **Exec form** `["cmd", "arg"]` for `CMD`/`ENTRYPOINT`: signals reach your process.
- `ENTRYPOINT` = the fixed program, `CMD` = default arguments (overridable).
- `ARG` = build-time only (visible in history!), `ENV` = runtime too.
- Order layers stable → volatile; add a `.dockerignore` (`.git`, `.env`, `node_modules`, `__pycache__`).
- Multi-stage: build in a full image, `COPY --from=build` only the artifact into a slim runtime.
- Secrets at build time: `RUN --mount=type=secret,id=token …` + `docker build --secret id=token,env=TOKEN`.

## Networking and storage

| Thing | Remember |
|---|---|
| `-p 8080:80` | HOST:CONTAINER; app must listen on `0.0.0.0`, not 127.0.0.1 |
| user-defined network | `docker network create app`; containers reach each other **by name** on container ports |
| named volume | managed by Docker, survives `docker rm`; for databases |
| bind mount | a host path; for development and config |
| `docker volume rm` | only when no container (even stopped) uses it |

## Compose

```yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets: [db_password]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
  adminer:
    image: adminer
    profiles: [debug]
volumes:
  pgdata:
secrets:
  db_password:
    file: ./db_password.txt
```

| Command | Does |
|---|---|
| `docker compose up -d --build` | build and start everything |
| `docker compose ps` / `logs -f api` | status / follow one service |
| `docker compose exec db psql -U postgres` | command in a running service |
| `docker compose run --rm api pytest` | one-off container |
| `docker compose down` / `down -v` | remove containers + network / also volumes |
| `docker compose --profile debug up -d` | include profiled services |
| `docker compose -f compose.yaml -f compose.prod.yaml up -d` | stack files (later wins) |
| `docker compose config` | print the merged result |
| `docker compose watch` | sync/rebuild on file changes |

## Production flags

| Flag | Effect |
|---|---|
| `--memory 256m` / `--cpus 0.5` / `--pids-limit 100` | limits (memory → OOM kill, exit 137; CPU → throttle) |
| `--restart unless-stopped` | restart policy (`no`, `on-failure[:N]`, `always`) |
| `--user 10001:10001` | not root |
| `--read-only --tmpfs /tmp` | immutable root filesystem |
| `--cap-drop ALL --cap-add NET_BIND_SERVICE` | minimal capabilities |
| `--security-opt no-new-privileges:true` | no setuid escalation |
| `--log-opt max-size=10m --log-opt max-file=3` | rotate logs |
| `docker update --memory 512m web` | change limits live |

## Troubleshooting

| Symptom | Look |
|---|---|
| exits immediately | `docker logs`, `docker ps -a` exit code |
| `port is already allocated` | `docker ps --format '{{.Names}} {{.Ports}}'` |
| connection reset from host | app bound to 127.0.0.1 inside the container |
| can't reach another container | same user-defined network? container port, not host port |
| `exec format error` | wrong CPU architecture: build for the host's platform |
| exit code 137 | SIGKILL: usually the OOM killer (check `--memory`) |
