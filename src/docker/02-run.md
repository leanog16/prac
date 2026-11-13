---
id: docker-run
title: Running & managing containers
summary: Detached containers, names, publishing ports, environment variables, logs, exec, the container lifecycle, inspect, and why containers exit immediately.
minutes: 35
---
## docker run, the most important command

```
docker run [OPTIONS] IMAGE [COMMAND] [ARGS...]
```

| Option | Meaning |
|---|---|
| `-d`, `--detach` | run in the background and print the container ID |
| `--name web` | give it a name (otherwise Docker invents one like `eager_turing`) |
| `-p 8080:80` | publish container port 80 on host port 8080 |
| `-e KEY=value` | set an environment variable (repeatable) |
| `--env-file .env` | load variables from a file |
| `--rm` | delete the container when it exits |
| `-it` | interactive + terminal, for shells (`docker run -it ubuntu bash`) |
| `-v`, `--mount` | attach storage (volumes module) |
| `--network` | attach to a network (networking module) |
| `--restart unless-stopped` | restart policy for long-running services |

```bash run
docker run -d --name web -p 8080:80 nginx
docker ps
curl -s localhost:8080 | head -4
```

The `PORTS` column reads `0.0.0.0:8080->80/tcp`: **host** port 8080 forwards to **container** port 80. Without `-p`, the container's port is only reachable from other containers, not from your machine.

> [!tip] Reading -p
> `-p HOST:CONTAINER`. The left side is yours to choose (any free port); the right side is whatever the app inside listens on (80 for nginx, 8000 for uvicorn, 8080 for Spring Boot).

## The lifecycle

```
           docker create          docker start            docker stop
 image ─────────────────> created ────────────> running ─────────────> exited
                                                  ▲  │                    │
                                                  │  └── process exits ───┘
                                                  └──── docker start ─────┘
                                     docker rm (exited/created)  ·  docker rm -f (any)
```

| Command | Effect |
|---|---|
| `docker ps` / `docker ps -a` | running / all containers |
| `docker stop NAME` | graceful stop (SIGTERM, then SIGKILL after 10 s) |
| `docker start NAME` | start a stopped container again (same writable layer) |
| `docker restart NAME` | stop + start |
| `docker kill NAME` | immediate SIGKILL |
| `docker rm NAME` | delete a stopped container (`-f` to force a running one) |
| `docker logs [-f] [--tail N] NAME` | the process's stdout/stderr |
| `docker exec NAME CMD` | run another command inside a **running** container |
| `docker inspect NAME` | full JSON details; `-f '{{.State.Status}}'` picks fields |

```bash run
docker run -d --name web nginx
docker exec web ls /usr/share/nginx/html
docker stop web
docker ps -a --format 'table {{.Names}}\t{{.Status}}'
docker start web
docker ps --format '{{.Names}} is {{.State}}'
```

## Why did my container exit immediately?

**A container lives exactly as long as its main process (PID 1).** When that process exits, the container stops. Common surprises:

- `docker run ubuntu` runs `bash` with no terminal attached; bash reads end-of-input and exits at once.
- Running a script that finishes (a migration, a test run) is supposed to exit: that's a "job", not a "service".
- A server that crashes on startup (missing config, bad env var) exits with a non-zero code. **Read the logs.**

```bash run
docker run -d --name db postgres:16
docker ps -a --format '{{.Names}}: {{.Status}}'
docker logs db
```

Postgres refuses to start without a superuser password. Fix it with an environment variable:

```bash run
docker run -d --name db -e POSTGRES_PASSWORD=devpass postgres:16
docker ps --format '{{.Names}}: {{.Status}}'
docker logs --tail 1 db
```

> [!exam] Debugging recipe
> 1. `docker ps -a` to see the status and exit code. 2. `docker logs NAME`. 3. `docker inspect NAME` for config (env, command, mounts, ports). 4. `docker exec NAME sh` (or a single command) to look inside a running container.

## Formatting output

Most list and inspect commands accept Go templates via `--format` (`-f` for inspect):

```bash run
docker run -d --name web -p 8080:80 nginx
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
docker inspect -f '{{.State.Status}} {{.Config.Image}} {{json .Config.Cmd}}' web
```

`{{json .X}}` prints a value as JSON; `table` at the start of a format adds column headers.

## Environment variables

Environment variables are how containers are configured: database URLs, ports, feature flags, credentials. The image author documents which ones the image reads (`POSTGRES_PASSWORD`, `NGINX_PORT`, `SPRING_PROFILES_ACTIVE`…).

```bash run
docker run --rm -e GREETING=Howdy alpine sh -c 'echo "$GREETING from $HOSTNAME"'
```

Single quotes matter there: they stop **your** shell from expanding `$GREETING` before Docker ever sees it, so the shell *inside the container* does the expansion.

:::quiz
q: `docker run -p 3000:8080 myapp` — which URL reaches the app from your laptop?
+ http://localhost:3000
- http://localhost:8080
- http://localhost:3000:8080
- it isn't reachable without EXPOSE
why: HOST:CONTAINER. Port 3000 on the host forwards to 8080 inside the container.
:::

:::quiz
q: A container's main process exits with code 0. What happens to the container?
- It restarts automatically
+ It stops (status Exited (0)) and remains until removed
- It's deleted
- It keeps running idle
why: A container lives as long as PID 1. Without --rm or a restart policy it stays in the exited state.
:::

:::quiz
q: Which runs `ls /app` inside an already-running container named api?
- `docker run api ls /app`
+ `docker exec api ls /app`
- `docker start api ls /app`
- `docker attach api ls /app`
why: exec runs an additional process in a running container. docker run would create a new container from an *image* named api.
:::

:::quiz
q: `docker rm web` fails with "container is running". Which works?
- `docker rm --stop web`
+ `docker stop web && docker rm web` (or `docker rm -f web`)
- `docker rmi web`
- `docker kill --rm web`
why: rm only deletes stopped containers unless forced. rmi removes images.
:::

:::quiz
q: Where do you look first when a container keeps exiting right after start?
- docker images
- docker network ls
+ docker logs NAME
- docker history IMAGE
why: The main process's output usually says exactly why it quit.
:::

:::exercise
id: dr-detach
level: 1
title: A background web server
compare: verify
---
Start an `nginx` container in the background named `web`.
---verify
docker ps --format '{{.Names}} {{.Image}} {{.State}}'
---solution
docker run -d --name web nginx
:::

:::exercise
id: dr-publish
level: 1
title: Reach it from the host
compare: verify
---
Run `nginx` in the background, named `site`, so that it's reachable at `http://localhost:8080`.
---verify
docker ps --format '{{.Names}} {{.Ports}}'
curl -s localhost:8080 | grep -o '<title>.*</title>'
---solution
docker run -d --name site -p 8080:80 nginx
:::

:::exercise
id: dr-env
level: 1
title: Pass an environment variable
---
Run a throwaway `alpine` container with the variable `GREETING` set to `hello`, which prints `hello world` by running `sh -c 'echo $GREETING world'`.
---hint
`-e GREETING=hello` goes before the image name; the command after it.
---solution
docker run --rm -e GREETING=hello alpine sh -c 'echo $GREETING world'
:::

:::exercise
id: dr-logs-tail
level: 2
title: Last two log lines
setup: docker run -d --name web -p 8080:80 nginx >/dev/null 2>&1 && curl -s localhost:8080/ >/dev/null && curl -s localhost:8080/missing >/dev/null
---
A container named `web` is running and has served a couple of requests. Show only the **last 2 lines** of its logs.
---solution
docker logs --tail 2 web
:::

:::exercise
id: dr-exec-ls
level: 2
title: Look inside
setup: docker run -d --name web nginx >/dev/null 2>&1
---
A container named `web` is running nginx. List the files in its `/usr/share/nginx/html` directory without stopping it.
---solution
docker exec web ls /usr/share/nginx/html
:::

:::exercise
id: dr-stop-rm
level: 2
title: Clean up one container
compare: verify
setup: docker run -d --name old nginx >/dev/null 2>&1; docker run -d --name keep nginx >/dev/null 2>&1
---
Two containers are running: `old` and `keep`. Stop and remove `old`, leaving `keep` running.
---verify
docker ps -a --format '{{.Names}} {{.State}}'
---solution
docker stop old
docker rm old
:::

:::exercise
id: dr-exitcode
level: 2
title: Exit codes
---
Run an `alpine` container named `job` that runs `sh -c 'exit 3'`. Then use `docker inspect` with a format string to print its status and exit code, like `exited 3`.
---hint
`docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' job`
---solution
docker run --name job alpine sh -c 'exit 3'
docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' job
:::

:::exercise
id: dr-format
level: 2
title: A custom ps table
setup: docker run -d --name web -p 8080:80 nginx >/dev/null 2>&1; docker run -d --name cache redis:7-alpine >/dev/null 2>&1; docker run --name job alpine true >/dev/null 2>&1
---
Three containers exist. Print **all** of them (running or not), one per line, as `NAME: STATUS`, using `--format`.
---solution
docker ps -a --format '{{.Names}}: {{.Status}}'
:::

:::exercise
id: dr-restart-cycle
level: 3
title: Stop, then start again
compare: verify
setup: docker run -d --name web -p 8080:80 nginx >/dev/null 2>&1
---
Stop the running `web` container, confirm `curl -s localhost:8080` now fails, then start the **same** container again (don't create a new one).
---verify
docker ps -a --format '{{.Names}} {{.State}}' | wc -l
curl -s localhost:8080 | grep -o '<h1>.*</h1>'
---solution
docker stop web
curl -s localhost:8080 || echo "down"
docker start web
:::

:::exercise
id: dr-fix-postgres
level: 3
title: The database won't stay up
compare: verify
setup: docker run -d --name db postgres:16 >/dev/null 2>&1
---
Someone ran `docker run -d --name db postgres:16` and the container keeps exiting. Find out why from its logs, remove the broken container, and start a working one named `db` with the superuser password `devpass`.
---hint
`docker logs db` says what's missing. You'll need `docker rm db` before reusing the name.
---verify
docker ps --format '{{.Names}}: {{.Status}}'
docker logs --tail 1 db
---solution
docker logs db
docker rm db
docker run -d --name db -e POSTGRES_PASSWORD=devpass postgres:16
:::

:::exercise
id: dr-why-exit
level: 2
title: Predict the status
mode: answer
---
On a fresh machine you run `docker run -d --name box ubuntu` and then `docker ps -a --format '{{.State}}'`. What single word does it print?
---answer
exited
---hint
What is ubuntu's default command, and what does it do with no terminal attached?
---solution
exited
---explain
The default command is `bash`. With no `-it`, bash has no input and exits immediately, so the container stops.
:::

:::exercise
id: dr-port-answer
level: 1
title: Which port?
mode: answer
---
`docker run -d -p 5050:80 nginx`. Which port number do you put in the browser on your machine?
---answer
5050
---solution
5050
:::

:::exercise
id: dr-two-envs
level: 3
title: Several variables at once
---
Run a throwaway `alpine` container with `APP_ENV=staging` and `APP_PORT=9000`, printing `staging on 9000` via `sh -c`.
---solution
docker run --rm -e APP_ENV=staging -e APP_PORT=9000 alpine sh -c 'echo "$APP_ENV on $APP_PORT"'
:::
