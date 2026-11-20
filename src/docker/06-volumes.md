---
id: docker-volumes
title: Volumes & bind mounts
summary: Why container filesystems are ephemeral, named volumes vs bind mounts, -v and --mount syntax, persisting a database, sharing data between containers, and live-editing with bind mounts.
minutes: 30
---
> [!project] Taskboard, step 6: data that survives
> Taskboard's database container from step 2 stores its data inside the container, so removing it loses every task. This step gives it a named volume, and gives you a bind mount for live code editing.

## Container storage is disposable

Files a container writes go into its **writable layer**, which is deleted with the container. That's a feature (containers are cattle, not pets) but it means **data you care about must live outside the container**.

```bash run
docker run --name scratch alpine sh -c 'echo important > /data.txt'
docker rm scratch > /dev/null
docker run --rm alpine cat /data.txt 2>&1 || echo "gone"
```

## Three kinds of mounts

| | Named volume | Bind mount | tmpfs |
|---|---|---|---|
| Lives in | Docker's storage area (`/var/lib/docker/volumes/…`) | **any path on your host** | memory |
| Created by | `docker volume create`, or automatically on first use | you (it's just a directory) | at container start |
| Typical use | databases, uploads: data Docker manages | source code during development, config files | secrets, scratch space |
| Survives `docker rm` | **yes** | yes (it's your directory) | no |
| Syntax | `-v pgdata:/var/lib/postgresql/data` | `-v ./site:/usr/share/nginx/html` | `--tmpfs /tmp` |

The rule for `-v SOURCE:TARGET[:ro]`: if SOURCE looks like a path (starts with `/`, `./` or `~`), it's a **bind mount**; otherwise it's a **volume name**. The longer `--mount type=volume,source=pgdata,target=/var/lib/postgresql/data` spells it out.

## Named volumes

```bash run
docker volume create notes
docker run --rm -v notes:/data alpine sh -c 'echo "remember the milk" > /data/todo.txt'
docker run --rm -v notes:/data alpine cat /data/todo.txt
docker volume ls
```

Two containers, one volume: the data outlived the first container. When a **new, empty** named volume is mounted over a directory that already has files in the image, Docker copies the image's files into the volume first.

| Command | Does |
|---|---|
| `docker volume create NAME` | create |
| `docker volume ls` | list |
| `docker volume inspect NAME` | details (mountpoint) |
| `docker volume rm NAME` | delete (fails if a container uses it) |
| `docker volume prune` | delete unused anonymous volumes (`-a` for named too) |
| `docker rm -v CONTAINER` | remove a container and its anonymous volumes |

## Bind mounts for development

A bind mount maps a host directory into the container **live**: edit a file on your machine and the container sees the change immediately. That's the standard way to develop inside containers without rebuilding.

```bash run
docker run -d --name site -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx:alpine
curl -s localhost:8080 | grep '<h1>'
sed -i 's/Hello from my static site!/Edited live!/' site/index.html
curl -s localhost:8080 | grep '<h1>'
```

`:ro` makes the mount read-only inside the container, a good habit when the container only needs to read.

> [!warn] Bind mounts hide what's in the image
> Mounting over a directory replaces its contents in the container with the host directory's. Mount an empty host folder over `/app` and your copied-in code "disappears".

## Worked example: proving data loss, then preventing it

```bash
docker run -d --name taskboard-db -e POSTGRES_PASSWORD=devpass postgres:16
# … the app creates tasks …
docker rm -f taskboard-db           # upgrade, mistake, or a new machine
docker run -d --name taskboard-db -e POSTGRES_PASSWORD=devpass postgres:16
# every task is gone: a brand-new, empty database
```

With a named volume mounted where PostgreSQL keeps its files:

```bash run
docker run -d --name taskboard-db -e POSTGRES_PASSWORD=devpass -v taskboard-pgdata:/var/lib/postgresql/data postgres:16
docker rm -f taskboard-db
docker run -d --name taskboard-db -e POSTGRES_PASSWORD=devpass -v taskboard-pgdata:/var/lib/postgresql/data postgres:16
docker logs taskboard-db | grep -i skipping
```

The second container found existing data in the volume and **skipped initialization**: the tasks survived. Where does each database keep its data? It's in the image docs: `/var/lib/postgresql/data` for PostgreSQL, `/var/lib/mysql` for MySQL, `/data` for Redis.

## Applying a bind mount to Taskboard

While developing Taskboard, rebuilding the image for every code change is slow. Mount your source folder over `/app` instead, and let uvicorn reload on changes:

```bash
docker run -d --name api-dev -p 8000:8000 -v ./:/app taskboard:dev \
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Edit `main.py` on your machine: the container sees the new file immediately through the mount, and `--reload` makes uvicorn restart with it. (Without `--reload`, the running process would keep serving the old code.)

> [!plain] In plain English
> A **named volume** is storage Docker manages for you (use it for databases). A **bind mount** maps a folder on your machine into the container (use it for source code during development).

## Common mistakes

> [!mistake] Bind-mounting over files the image needs
> Mounting `./:/app` hides everything the image put in `/app`. If the image installed dependencies **into** `/app` (e.g. `node_modules`), they vanish. Install them elsewhere (like Python's site-packages) or protect them with an extra volume.

> [!mistake] `docker compose down -v` in the wrong terminal
> `-v` deletes named volumes: that's your development database. Know what the flag does before typing it.

:::quiz
q: Which survives `docker rm` of the container that used it?
- the container's writable layer
+ a named volume
- a tmpfs mount
- files written to /tmp in the container
why: Named volumes (and bind-mounted host directories) live outside the container's lifecycle.
:::

:::quiz
q: In `-v ./config:/etc/app:ro`, what kind of mount is it?
+ a read-only bind mount of the host's ./config directory
- a named volume called ./config
- a tmpfs mount
- a copy of ./config made at build time
why: A source that looks like a path means a bind mount; :ro makes it read-only.
:::

:::quiz
q: `docker volume rm pgdata` fails with "volume is in use". Why?
- volumes can't be removed
+ a container (possibly stopped) still references the volume
- you need --force for named volumes always
- the volume isn't empty
why: Remove (not just stop) the containers that use it first.
:::

:::quiz
q: You need your editor's changes to appear in a running container instantly. Which mount?
- a named volume
+ a bind mount of your source directory
- COPY in the Dockerfile
- tmpfs
why: Bind mounts share the host directory live. COPY bakes files in at build time.
:::

:::exercise
id: dv-create
level: 1
title: Create a volume
compare: verify
---
Create a named volume called `uploads`.
---verify
docker volume ls --format '{{.Name}}'
---solution
docker volume create uploads
:::

:::exercise
id: dv-share
level: 2
title: Hand data between containers
---
Using a volume named `notes`: run a throwaway `alpine` container that writes `hello volume` into `/data/msg.txt`, then a **second** throwaway container that prints that file.
---hint
`docker run --rm -v notes:/data alpine sh -c 'echo hello volume > /data/msg.txt'`
---solution
docker run --rm -v notes:/data alpine sh -c 'echo hello volume > /data/msg.txt'
docker run --rm -v notes:/data alpine cat /data/msg.txt
:::

:::exercise
id: dv-bind-site
level: 2
title: Serve a folder
compare: verify
---
Serve the `~/site` folder with `nginx:alpine` on host port `8080` using a **read-only bind mount** onto `/usr/share/nginx/html`, in a background container named `site`.
---verify
curl -s localhost:8080/about.html | grep -o '<h1>.*</h1>'
docker inspect -f '{{range .Mounts}}{{.Type}} {{.Destination}} {{.RW}}{{end}}' site
---solution
docker run -d --name site -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx:alpine
:::

:::exercise
id: dv-live-edit
level: 2
title: Edit without rebuilding
setup: docker run -d --name site -p 8080:80 -v /home/student/site:/usr/share/nginx/html:ro nginx:alpine >/dev/null 2>&1
---
`~/site` is bind-mounted into a running nginx on port 8080. Change the `<h1>` text in `site/index.html` to `Updated!` (on the host), then fetch the page with curl and show only the `<h1>` line.
---hint
`sed -i 's/Hello from my static site!/Updated!/' site/index.html`
---solution
sed -i 's/Hello from my static site!/Updated!/' site/index.html
curl -s localhost:8080 | grep '<h1>'
:::

:::exercise
id: dv-persist-db
level: 3
title: A database that survives
compare: verify
---
Start postgres 16 as container `db` (password `devpass`) storing its data in a named volume `pgdata`. Then **remove** the container entirely and start a new `db` container with the same volume.
---verify
docker logs db | grep -c 'Skipping initialization'
docker volume ls --format '{{.Name}}' | grep pgdata
---solution
docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql/data postgres:16
docker rm -f db
docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql/data postgres:16
:::

:::exercise
id: dv-rm-in-use
level: 2
title: Delete a volume properly
compare: verify
setup: docker volume create cache >/dev/null && docker run --name worker -v cache:/cache alpine true >/dev/null 2>&1
---
A stopped container `worker` uses the volume `cache`. Delete the volume (you'll need to deal with the container first).
---verify
docker volume ls --format '{{.Name}}' | grep -c cache || true
docker ps -a --format '{{.Names}}' | wc -l
---solution
docker rm worker
docker volume rm cache
:::

:::exercise
id: dv-init-copy
level: 3
title: Volumes copy image content
---
Mount a **new** named volume `html` at `/usr/share/nginx/html` in a throwaway `nginx` container and list that directory. (Notice the files appear: Docker initialized the empty volume with the image's content.)
---solution
docker run --rm -v html:/usr/share/nginx/html nginx ls /usr/share/nginx/html
:::

:::exercise
id: dv-backup
level: 4
title: Back up a volume
compare: verify
setup: docker run --rm -v notes:/data alpine sh -c 'echo one > /data/a.txt; echo two > /data/b.txt' >/dev/null 2>&1
---
The volume `notes` holds a few files. Copy every file from it into a new host directory `~/backup` by running a throwaway `alpine` container that mounts **both** the volume (at `/data`) and `./backup` (at `/backup`).
---hint
`mkdir -p backup && docker run --rm -v notes:/data -v ./backup:/backup alpine sh -c 'cp /data/* /backup/'`
---verify
ls backup
cat backup/b.txt
---solution
mkdir -p backup
docker run --rm -v notes:/data -v ./backup:/backup alpine sh -c 'cp /data/* /backup/'
:::

:::exercise
id: dv-which-mount
level: 2
title: Volume or bind?
mode: answer
---
Is `-v data:/var/lib/mysql` a named volume or a bind mount? Answer `volume` or `bind`.
---answer
volume
---answer
named volume
---solution
volume
:::

:::exercise
id: dv-hidden
level: 3
title: Where did my code go?
mode: answer
---
An image copies the app into `/app`. You run it with `-v ./empty-dir:/app` where `empty-dir` is empty. How many files does `ls /app` list inside the container?
---answer
0
---answer
zero
---solution
0
---explain
A bind mount replaces the directory's contents with the host directory's, so `/app` appears empty.
:::

:::exercise
id: proj-dk-06-pgdata
level: 2
title: "Project 6: persistent tasks"
compare: verify
path: ops/docker/06-pgdata.sh
---
Start `taskboard-db` (postgres:16, password `devpass`) with its data in a named volume `taskboard-pgdata`. Then simulate an upgrade: **remove** the container and start a new `taskboard-db` with the same volume.
---verify
docker volume ls --format '{{.Name}}'
docker logs taskboard-db | grep -c 'Skipping initialization'
---solution
docker run -d --name taskboard-db -e POSTGRES_PASSWORD=devpass -v taskboard-pgdata:/var/lib/postgresql/data postgres:16
docker rm -f taskboard-db
docker run -d --name taskboard-db -e POSTGRES_PASSWORD=devpass -v taskboard-pgdata:/var/lib/postgresql/data postgres:16
:::

:::exercise
id: proj-dk-06-dev-mount
level: 3
title: "Project 6b: live-edit the API"
cwd: /home/student/taskboard
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile && docker build -q -t taskboard:dev . >/dev/null 2>&1
path: ops/docker/06-dev-mount.sh
---
`taskboard:dev` is built. Run it in the background as `api-dev` on port 8000 with the current directory **bind-mounted** at `/app`, overriding the command to `uvicorn main:app --host 0.0.0.0 --port 8000 --reload` so code changes are picked up. Then change the health response on the host with `sed -i 's/"ok"/"live"/' main.py`, and curl `/health` to see the change without rebuilding.
---solution
docker run -d --name api-dev -p 8000:8000 -v ./:/app taskboard:dev uvicorn main:app --host 0.0.0.0 --port 8000 --reload
sed -i 's/"ok"/"live"/' main.py
curl -s localhost:8000/health
:::
