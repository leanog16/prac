---
id: docker-network
title: Networking
summary: Publishing ports in depth, why localhost inside a container isn't your machine, the 0.0.0.0 binding rule, user-defined networks with DNS by container name, and connecting containers.
minutes: 30
---
> [!project] Taskboard, step 7: API and database on one network
> Taskboard's API must reach PostgreSQL, but the database should **not** be reachable from outside. A user-defined network gives containers private DNS names, so only the API is published to the host.

## Each container has its own network stack

A container gets its own network namespace: its own interfaces, its own IP address on a Docker network, its own `localhost`. Two consequences trip up everyone at least once:

1. **`localhost` inside a container means that container**, not your laptop and not other containers.
2. **An app must listen on `0.0.0.0`** (all interfaces) to be reachable from outside its container. An app bound to `127.0.0.1` inside a container accepts connections only from inside that same container.

## Publishing ports

```
-p [HOST_IP:]HOST_PORT:CONTAINER_PORT
```

| Flag | Meaning |
|---|---|
| `-p 8080:80` | host port 8080 (all interfaces) → container port 80 |
| `-p 127.0.0.1:8080:80` | only reachable from the host itself |
| `-p 80` | container port 80 → a random free host port |
| `-P` | publish every `EXPOSE`d port to random host ports |
| `docker port NAME` | show the mappings |

Publishing is only for traffic **from outside Docker**. Containers on the same network talk to each other directly on the container port, no `-p` needed.

## The 0.0.0.0 trap

uvicorn listens on `127.0.0.1` by default. That's right for your laptop and wrong in a container:

```bash run
cd fastapi-app
printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir -r requirements.txt\nCMD ["uvicorn", "main:app", "--port", "8000"]\n' > Dockerfile
docker build -q -t api . > /dev/null
docker run -d --name api -p 8000:8000 api > /dev/null
curl -s localhost:8000/health || echo "curl failed with exit code $?"
docker logs api | tail -1
```

The log says it all: `Uvicorn running on http://127.0.0.1:8000`. Adding `--host 0.0.0.0` fixes it. The same applies to Flask (`--host=0.0.0.0`), Node (`app.listen(3000, '0.0.0.0')`) and anything else that defaults to loopback. (Spring Boot's Tomcat already listens on all interfaces.)

## Networks and DNS

Docker creates three networks: `bridge` (the default), `host` and `none`. Containers on the **default bridge** can reach each other only by IP address. On a **user-defined network**, Docker runs an embedded DNS server, so containers find each other **by name**:

```bash run
docker network create appnet
docker run -d --name cache --network appnet redis:7-alpine
docker run -d --name web --network appnet nginx
docker exec web ping -c 1 cache
docker exec cache redis-cli ping
```

```bash run
docker run -d --name a nginx
docker run -d --name b nginx
docker exec a curl -s http://b/ || echo "default bridge: no DNS, curl exit code $?"
```

> [!exam] Always use a user-defined network
> Put related containers on a network you create (Compose does this for you automatically). Then your API connects to `postgres://db:5432`, with `db` being the container (or Compose service) name.

| Command | Does |
|---|---|
| `docker network create NAME` | create a bridge network |
| `docker network ls` | list |
| `docker network inspect NAME` | subnet, attached containers and their IPs |
| `docker network connect NET CONTAINER` | attach a running container |
| `docker network disconnect NET CONTAINER` | detach |
| `docker run --network NET …` | start a container on NET |

## Container-to-container HTTP

```bash run
cd fastapi-app
printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir -r requirements.txt\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile
docker build -q -t api . > /dev/null
docker network create backend
docker run -d --name api --network backend api
docker run -d --name proxy --network backend nginx
docker exec proxy curl -s http://api:8000/items/7
```

Note `http://api:8000`: the **container** port, by **container name**, with no `-p` anywhere. Nothing was published to the host at all.

## Worked example: drawing the topology first

```
                host machine
  curl localhost:8000          (no port 5432 published)
            │
     ┌──────▼──────────────── network: taskboard-net ────────────┐
     │  container "api"  ──── postgresql://taskboard-db:5432 ──► container "taskboard-db" │
     │  port 8000 published                                       port 5432 internal only │
     └────────────────────────────────────────────────────────────┘
```

Two rules make this work:

1. Containers on the same **user-defined** network resolve each other **by container name** (Docker runs a small DNS server for them). The default `bridge` network doesn't do this.
2. Container-to-container traffic uses the **container port** (5432), never a published host port. Publishing is only for traffic coming from **outside** Docker.

```bash
docker network create taskboard-net
docker run -d --name taskboard-db --network taskboard-net -e POSTGRES_PASSWORD=devpass postgres:16
docker run -d --name api --network taskboard-net -p 8000:8000 \
  -e DATABASE_URL=postgresql://postgres:devpass@taskboard-db:5432/postgres taskboard:dev
```

The database URL's host is `taskboard-db`, the container name. In the FastAPI track the URL came from `settings.database_url`, so the same image works on a laptop and in production just by changing an environment variable.

> [!plain] In plain English
> A Docker network is a private LAN for containers. Containers on it can call each other by name; the outside world only reaches the ports you explicitly publish with `-p`.

## Common mistakes

> [!mistake] `localhost` inside a container
> Inside the API container, `localhost` is the API container itself, not the database and not your laptop. Use the other container's name.

> [!mistake] Publishing the database "to make it work"
> `-p 5432:5432` on production databases exposes them to anything that can reach the host. Keep databases internal; use `docker exec` or a temporary tunnel for admin access.

:::quiz
q: Inside container A, what does `curl http://localhost:5432` reach?
+ port 5432 inside container A itself
- port 5432 on the host machine
- the container named postgres
- every container on the network
why: localhost is per network namespace. Each container has its own.
:::

:::quiz
q: Two containers on the default bridge network. Can `web` reach `db` with `http://db:5432`?
- Yes, always
+ No; the default bridge has no name-based DNS. Use a user-defined network.
- Only if db has -p 5432:5432
- Only with --link, which is required
why: Docker's embedded DNS works on user-defined networks (and Compose networks).
:::

:::quiz
q: An app in a container is published with `-p 8000:8000`, but curl from the host gets "Connection reset by peer". The most likely cause?
- The port isn't EXPOSEd
+ The app listens on 127.0.0.1 inside the container instead of 0.0.0.0
- curl doesn't support containers
- Port 8000 is reserved
why: Published traffic arrives on the container's network interface, not its loopback.
:::

:::quiz
q: The API container talks to the DB container on a shared network. Which port does it use?
+ the DB's container port (e.g. 5432), regardless of any -p mapping
- the host port from -p
- any random port
- port 80
why: -p only affects traffic from outside Docker. Inside the network, containers use the real listening port.
:::

:::exercise
id: dn-create
level: 1
title: Make a network
compare: verify
---
Create a user-defined network named `appnet`.
---verify
docker network ls --format '{{.Name}}' | sort
---solution
docker network create appnet
:::

:::exercise
id: dn-host-port
level: 1
title: A different host port
compare: verify
---
Run `nginx` in the background so it's reachable from the host at port `9090`.
---verify
curl -s localhost:9090 | grep -o '<title>.*</title>'
---solution
docker run -d -p 9090:80 nginx
:::

:::exercise
id: dn-dns
level: 2
title: Find each other by name
compare: verify
---
Create a network `appnet`, then start two background containers on it: `cache` from `redis:7-alpine` and `web` from `nginx`.
---verify
docker exec web ping -c 1 cache > /dev/null && echo "web can reach cache"
docker inspect -f '{{json .NetworkSettings.Networks}}' web | grep -o appnet
---solution
docker network create appnet
docker run -d --name cache --network appnet redis:7-alpine
docker run -d --name web --network appnet nginx
:::

:::exercise
id: dn-connect
level: 2
title: Join an existing network
compare: verify
setup: docker network create shop >/dev/null && docker run -d --name db --network shop -e POSTGRES_PASSWORD=x postgres:16-alpine >/dev/null 2>&1 && docker run -d --name web nginx >/dev/null 2>&1
---
`db` is on the `shop` network, but `web` was started on the default bridge and can't resolve `db`. Connect the running `web` container to `shop` (without recreating it).
---verify
docker exec web ping -c 1 db > /dev/null && echo "web resolves db"
---solution
docker network connect shop web
:::

:::exercise
id: dn-fix-host
level: 3
title: Fix the unreachable API
mode: file
file: Dockerfile
cwd: /home/student/fastapi-app
---starter
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--port", "8000"]
---run
docker build -q -t api . >/dev/null
docker run -d -p 8000:8000 api >/dev/null
curl -s localhost:8000/
---
The editor holds a Dockerfile whose container starts fine but can't be reached on the published port. Fix it.
---hint
Check what address uvicorn binds to by default.
---solution
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: dn-c2c
level: 3
title: Service to service
compare: verify
cwd: /home/student/fastapi-app
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir -r requirements.txt\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile && docker build -q -t api . >/dev/null 2>&1
---
An image `api` exists (FastAPI on port 8000). Create a network `backend`, run `api` on it as container `api` **without publishing any port**, run an `nginx` container named `proxy` on the same network, and from inside `proxy` curl `http://api:8000/items/7?q=net` (silently).
---solution
docker network create backend
docker run -d --name api --network backend api >/dev/null
docker run -d --name proxy --network backend nginx >/dev/null
docker exec proxy curl -s "http://api:8000/items/7?q=net"
---verify
docker exec proxy curl -s "http://api:8000/items/7?q=net"; echo
docker ps --format '{{.Names}} [{{.Ports}}]' | sort
:::

:::exercise
id: dn-localhost-only
level: 3
title: Only from this machine
compare: verify
---
Run `nginx` in the background on host port `8443`, but bound so it's only reachable from the host's loopback interface `127.0.0.1`.
---verify
docker ps --format '{{.Ports}}'
---solution
docker run -d -p 127.0.0.1:8443:80 nginx
:::

:::exercise
id: dn-port-cmd
level: 2
title: What's mapped where?
setup: docker run -d --name web -p 8081:80 nginx >/dev/null 2>&1
---
Show the port mappings of the container `web` using the dedicated command.
---solution
docker port web
:::

:::exercise
id: dn-curl-code
level: 2
title: Predict the curl error
mode: answer
---
Container `a` and container `b` are both on the **default bridge** network. From inside `a` you run `curl -s http://b/; echo $?`. What exit code is printed? (curl uses 6 for "could not resolve host", 7 for "couldn't connect".)
---answer
6
---solution
6
:::

:::exercise
id: dn-which-port
level: 3
title: Which port inside the network?
mode: answer
---
`docker run -d --name db --network net -p 15432:5432 postgres`. Another container on `net` connects to the database at `db:____`. Fill in the port.
---answer
5432
---solution
5432
:::

:::exercise
id: proj-dk-07-network
level: 3
title: "Project 7: a private network"
compare: verify
cwd: /home/student/taskboard
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile && docker build -q -t taskboard:dev . >/dev/null 2>&1
---
Create the network `taskboard-net`. On it, start `taskboard-db` (postgres:16, password `devpass`) **without** publishing any port, and `api` from `taskboard:dev` published on host port **8000**, with `DATABASE_URL=postgresql://postgres:devpass@taskboard-db:5432/postgres`.
---verify
docker ps --format '{{.Names}} {{.Ports}}' | sort
docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' taskboard-net | tr ' ' '\n' | sort | grep .
curl -s localhost:8000/health
---solution
docker network create taskboard-net
docker run -d --name taskboard-db --network taskboard-net -e POSTGRES_PASSWORD=devpass postgres:16
docker run -d --name api --network taskboard-net -p 8000:8000 -e DATABASE_URL=postgresql://postgres:devpass@taskboard-db:5432/postgres taskboard:dev
:::

:::exercise
id: proj-dk-07-internal-call
level: 3
title: "Project 7b: call the API from inside"
cwd: /home/student/taskboard
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile && docker build -q -t taskboard:dev . >/dev/null 2>&1 && docker network create taskboard-net >/dev/null && docker run -d --name api --network taskboard-net taskboard:dev >/dev/null
---
`api` runs on `taskboard-net` with **no** published port. Start an `nginx` container named `proxy` on the same network, then from inside `proxy` request `http://api:8000/tasks` silently with curl.
---solution
docker run -d --name proxy --network taskboard-net nginx
docker exec proxy curl -s http://api:8000/tasks
:::
