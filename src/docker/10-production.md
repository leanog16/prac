---
id: docker-prod
title: Limits, security & multi-platform images
summary: Memory, CPU and PID limits, restart policies, read-only root filesystems, dropping Linux capabilities, no-new-privileges, rootless Docker, image scanning and SBOMs, multi-platform builds with buildx, and moving images with save and load.
minutes: 40
---
> [!project] Taskboard, step 10: guardrails at runtime
> The production image is good; now constrain how it runs. Taskboard gets memory and CPU limits, a restart policy, a read-only filesystem with a writable `/tmp`, and dropped capabilities.

## A container is only as safe as its settings

By default a container can use **all** the host's memory and CPU, runs as root, keeps a dozen Linux capabilities, and can write anywhere in its filesystem. That's convenient on a laptop and dangerous in production. One memory leak in one container can get the whole host's processes OOM-killed, and one remote-code-execution bug can give an attacker root inside the container.

The fixes are a handful of `docker run` flags (and the matching Compose keys). This lesson covers them, then image supply-chain hygiene, then building for more than one CPU architecture.

## Resource limits

```bash run
docker run -d --name api --memory 256m --cpus 0.5 --pids-limit 100 nginx
docker stats --no-stream --format '{{.Name}}  {{.MemUsage}}  {{.CPUPerc}}'
```

| Flag | Limits | What happens at the limit |
|---|---|---|
| `--memory 256m` (`-m`) | RAM | the kernel **OOM-kills** the main process; exit code **137** and `"OOMKilled": true` in inspect |
| `--memory-reservation 128m` | soft floor | reclaimed first when the host is under pressure |
| `--cpus 0.5` | CPU time | the process is **throttled**, never killed; it just runs slower |
| `--pids-limit 100` | number of processes/threads | `fork` fails; stops fork bombs |

Limits are stored on the container, so you can read them back (memory in bytes, CPU in billionths of a CPU) and change them on a live container:

```bash run
docker run -d --name worker -m 256m --cpus 1 nginx
docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' worker
docker update --memory 512m worker
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' worker
```

> [!warn] Runtimes that read the host's memory
> Older JVMs and some Node versions sized their heap from the **host's** RAM, not the container limit, and got OOM-killed. Modern Java (10+) is container-aware: use `-XX:MaxRAMPercentage=75` instead of a fixed `-Xmx`. For Node, set `--max-old-space-size` below the limit.

## Restart policies

| Policy | Restarts when… |
|---|---|
| `no` (default) | never |
| `on-failure[:N]` | the process exits **non-zero**, at most N times |
| `always` | it stops for any reason, including after a daemon restart, even if you stopped it by hand before the restart |
| `unless-stopped` | like `always`, but a container you stopped with `docker stop` stays stopped |

```bash run
docker run -d --name job --restart on-failure:3 alpine sh -c 'exit 1'
docker inspect -f '{{.HostConfig.RestartPolicy.Name}} max={{.HostConfig.RestartPolicy.MaximumRetryCount}}' job
```

`unless-stopped` is the usual choice for long-running services on a single host. Orchestrators (Kubernetes, ECS) have their own restart logic, so leave the Docker policy at `no` there.

## Least privilege at runtime

Each of these removes a way an attacker could escalate after breaking into your app:

```bash
docker run -d --name api \
  --user 10001:10001 \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --cap-add NET_BIND_SERVICE \
  --security-opt no-new-privileges:true \
  myapi:1.4.2
```

- **`--user`** (or `USER` in the Dockerfile): don't run as root. Root in a container is the same UID 0 as root on the host; only namespaces stand between them.
- **`--read-only`** makes the root filesystem read-only, so malware can't drop files or modify your code. Give the app writable space where it needs it: `--tmpfs /tmp` (in-memory) or a volume.
- **`--cap-drop ALL`** removes Linux **capabilities**, the slices of root's power (`CHOWN`, `NET_RAW`, `SYS_ADMIN`, …). Add back only what you need: `NET_BIND_SERVICE` to bind ports below 1024 as non-root.
- **`--security-opt no-new-privileges`** stops setuid binaries (like `su`) from gaining privileges.
- **Never `--privileged`** for an app: it gives the container nearly full access to the host's devices and kernel.
- **Never mount `/var/run/docker.sock`** into an app container. Access to the Docker socket is root on the host.

Try writing to a read-only container, then to a tmpfs:

```bash run
# the first command fails on purpose
docker run --rm --read-only alpine sh -c 'echo hacked > /etc/motd' || echo "write refused"
docker run --rm --read-only --tmpfs /tmp alpine sh -c 'echo scratch > /tmp/x && cat /tmp/x'
```

> [!tip] Rootless Docker
> Normally the Docker **daemon** itself runs as root. **Rootless mode** runs the daemon and containers as an ordinary user, so even a full container escape lands as an unprivileged user. Podman is rootless by default.

## The image supply chain

Your image contains hundreds of packages you didn't write. Keep them honest:

- **Scan** images for known CVEs: `docker scout cves myapi:1.4.2`, `trivy image myapi:1.4.2`, or `grype`. Run it in CI and fail the build on critical findings.
- **Generate an SBOM** (software bill of materials), a list of every package in the image: `docker buildx build --sbom=true …` or `syft myapi:1.4.2`.
- **Pin bases by digest** for reproducible builds: `FROM python:3.12-slim@sha256:…`, with a bot (Dependabot, Renovate) to bump it.
- **Use small bases**: `-slim`, `-alpine`, distroless (`gcr.io/distroless/…`) or `scratch`. Fewer packages mean fewer CVEs and no shell for an attacker.
- **Sign** images (`cosign sign`) and verify signatures before deploying.

## Build secrets, not ARG secrets

`ARG` and `ENV` values are saved in the image history, where anyone with the image can read them. For a token the **build** needs (a private package index, say), mount it as a BuildKit secret that exists only during that one `RUN`:

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim
RUN --mount=type=secret,id=pip_token \
    PIP_INDEX_URL="https://__token__:$(cat /run/secrets/pip_token)@pypi.example.com/simple" \
    pip install --no-cache-dir -r requirements.txt
```

```bash
docker build --secret id=pip_token,env=PIP_TOKEN -t myapi .
```

Runtime secrets (database passwords) come from the environment or from secret files mounted at run time, never baked into the image.

## Multi-platform images

Apple Silicon laptops and AWS Graviton servers are **arm64**; most CI runners and older servers are **amd64**. An image built on one runs on the other only through slow emulation, or not at all (`exec format error`).

`docker buildx` builds one tag that contains a variant for each platform (a **manifest list**). Clients pull the variant that matches their CPU automatically:

```bash
docker buildx create --use                       # a builder that supports multi-platform
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/acme/api:1.4.2 --push .
docker buildx imagetools inspect ghcr.io/acme/api:1.4.2   # lists both platforms
```

- Multi-platform builds must `--push` to a registry (or use `--load` for a single platform), because the classic local image store holds one platform per tag.
- Cross-building uses QEMU emulation, which is slow for compile-heavy steps. In a multi-stage build, run the compile stage on the build machine's native platform and cross-compile using the `BUILDPLATFORM`/`TARGETPLATFORM`/`TARGETARCH` build args: `FROM --platform=$BUILDPLATFORM golang:1.23 AS build`.
- `docker run --platform linux/amd64 …` forces a specific variant, which is handy for reproducing a production bug on an ARM laptop.

## Moving images without a registry

`docker save` writes images to a tar archive; `docker load` reads it back. Use it for air-gapped servers, or to hand an image to someone directly:

```bash run
docker pull nginx:alpine
docker save -o nginx.tar nginx:alpine
docker rmi nginx:alpine
docker load -i nginx.tar
```

(`docker export`/`import` are different: they flatten a **container's** filesystem and lose the layers and metadata.)

## Logs that don't fill the disk

The default `json-file` logging driver keeps everything forever. Cap it per container, or daemon-wide in `/etc/docker/daemon.json`:

```bash
docker run -d --log-opt max-size=10m --log-opt max-file=3 nginx
```

Other drivers ship logs elsewhere: `local` (compressed, rotated), `journald`, `awslogs`, `gcplogs`, `fluentd`. In Compose the same settings go under `logging: {driver: json-file, options: {max-size: 10m}}`.

## Worked example: sizing Taskboard's limits

Don't guess limits; measure first:

```bash run
docker run -d --name api -m 512m nginx
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}'
```

A reasonable process:

1. Run the app under realistic load (a load-testing tool like `hey`, `k6` or `locust`) and watch `docker stats`.
2. Set the memory limit about **1.5–2×** the observed peak, so normal spikes don't trigger the OOM killer.
3. Set CPU limits to protect neighbours on a shared host, then check that latency under load stays acceptable.
4. Alert when usage approaches the limit, rather than finding out from exit code 137.

For two uvicorn workers serving Taskboard, a peak of ~180 MB might lead to `--memory 384m --cpus 1`.

## The hardened run command

```bash
docker run -d --name api \
  --restart unless-stopped \
  --memory 384m --cpus 1 --pids-limit 200 \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 8000:8000 --env-file prod.env \
  ghcr.io/acme/taskboard:1.0.0
```

Taskboard writes nothing to disk except temporary files (uploads go to S3 in production), so a read-only root filesystem costs nothing and blocks a whole class of attacks. Port 8000 is above 1024, so no capability is needed to bind it, and `--cap-drop ALL` doesn't need any exceptions.

> [!plain] In plain English
> Limits stop one misbehaving container from starving everything else on the machine; security flags shrink what an attacker could do if they broke into the app.

## Common mistakes

> [!mistake] Read-only filesystem, but the app writes somewhere
> Python writes `.pyc` files and some libraries write caches. Symptoms are `Read-only file system` errors at startup. Set `PYTHONDONTWRITEBYTECODE=1`, point caches at `/tmp`, and mount a `tmpfs` there.

:::quiz
q: A container with `--memory 256m` tries to use 300 MB. What happens?
- it is throttled and runs slower
+ the kernel OOM-kills it; it exits with code 137
- Docker swaps the extra 44 MB to disk and continues
- the `docker run` command fails before starting
why: Memory is a hard limit enforced by the kernel's OOM killer. CPU limits throttle; memory limits kill. 137 = 128 + 9 (SIGKILL).
:::

:::quiz
q: Which restart policy keeps a container stopped after you `docker stop` it, even across a daemon restart?
- always
+ unless-stopped
- on-failure
- no, but only if you also pass --rm
why: `always` would bring it back when the daemon restarts; `unless-stopped` remembers that you stopped it.
:::

:::quiz
q: Why is `ARG GITHUB_TOKEN` a bad way to give a build access to a private repository?
+ build args are recorded in the image history, so anyone with the image can read the token
- ARG values can't be used in RUN instructions
- ARG is only available in the final stage
- BuildKit ignores ARG
why: `docker history --no-trunc` shows them. Use `RUN --mount=type=secret` instead.
:::

:::quiz
q: You build an image on an M-series Mac and the amd64 production server fails with `exec format error`. The fix?
- add `--privileged` on the server
+ build for the server's platform, e.g. `docker buildx build --platform linux/amd64,linux/arm64 … --push`
- use an alpine base image
- set `ENV ARCH=amd64`
why: The binaries in the image are arm64. Build for amd64 (or both) with buildx.
:::

:::quiz
q: Which flag lets a non-root process bind port 80 after `--cap-drop ALL`?
- `--privileged`
- `--security-opt no-new-privileges`
+ `--cap-add NET_BIND_SERVICE`
- `--user root`
why: Binding ports below 1024 needs the NET_BIND_SERVICE capability. Add back exactly that one.
:::

:::exercise
id: dp-limits
level: 1
title: Cap memory and CPU
compare: verify
---
Run `nginx` in the background as a container named `api` limited to **256 MB** of memory and **half a CPU**.
---verify
docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' api
---solution
docker run -d --name api --memory 256m --cpus 0.5 nginx
:::

:::exercise
id: dp-pids
level: 2
title: Stop fork bombs
compare: verify
---
Run `nginx` in the background as `web`, allowing at most **200** processes inside it and restarting it automatically **unless you stop it yourself**.
---verify
docker inspect -f '{{.HostConfig.PidsLimit}} {{.HostConfig.RestartPolicy.Name}}' web
---solution
docker run -d --name web --pids-limit 200 --restart unless-stopped nginx
:::

:::exercise
id: dp-stats
level: 2
title: Who's using what?
setup: docker run -d --name api -m 512m nginx >/dev/null 2>&1; docker run -d --name cache -m 128m redis >/dev/null 2>&1
---
Two containers are running. Print one line per running container in the form `NAME MEMUSAGE` (e.g. `api 12.0MiB / 512MiB`), as a single snapshot, not a live stream.
---hint
`docker stats` has `--no-stream` and `--format`.
---hint
The placeholders are `{{.Name}}` and `{{.MemUsage}}`.
---solution
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'
:::

:::exercise
id: dp-update
level: 2
title: Raise a limit live
compare: verify
setup: docker run -d --name worker -m 128m nginx >/dev/null 2>&1
---
`worker` keeps getting OOM-killed at 128 MB. Raise its memory limit to **512 MB** without recreating the container.
---verify
docker inspect -f '{{.HostConfig.Memory}}' worker
docker ps --format '{{.Names}}'
---solution
docker update --memory 512m worker
:::

:::exercise
id: dp-readonly
level: 3
title: Read-only with scratch space
---
Run a throwaway `alpine` container with a **read-only root filesystem** and an in-memory writable `/tmp`. Inside it, write `ok` to `/tmp/probe` and print the file.
---hint
`--read-only` plus `--tmpfs /tmp`.
---solution
docker run --rm --read-only --tmpfs /tmp alpine sh -c 'echo ok > /tmp/probe && cat /tmp/probe'
:::

:::exercise
id: dp-hardened
level: 3
title: A hardened run command
compare: verify
---
Start `nginx` in the background as `edge` with: a read-only root filesystem, **all** capabilities dropped and only `NET_BIND_SERVICE` added back, and `--security-opt no-new-privileges:true`.
---verify
docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}} {{.HostConfig.SecurityOpt}}' edge
---solution
docker run -d --name edge --read-only --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges:true nginx
:::

:::exercise
id: dp-save-load
level: 2
title: Ship an image by file
compare: verify
setup: docker pull redis:7 >/dev/null 2>&1
---
Save the `redis:7` image to `redis.tar`, delete the image, then load it back from the file.
---verify
ls redis.tar
docker images --format '{{.Repository}}:{{.Tag}}'
---solution
docker save -o redis.tar redis:7
docker rmi redis:7
docker load -i redis.tar
:::

:::exercise
id: dp-secret-mount
level: 3
title: A build secret
mode: code
lang: dockerfile
file: Dockerfile
---
The build needs an npm token to install private packages. Rewrite the install step so the token comes from a BuildKit secret with id `npm_token`, read from `/run/secrets/npm_token` and exported as `NPM_TOKEN` **only for that RUN**. Don't use `ARG` or `ENV` for the token.
---starter
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
ARG NPM_TOKEN
RUN npm ci
COPY . .
CMD ["node", "server.js"]
---rule
^RUN\s+--mount=type=secret,id=npm_token
`RUN --mount=type=secret,id=npm_token`
---rule
NPM_TOKEN=\$\(cat /run/secrets/npm_token\)
Read the token from `/run/secrets/npm_token` into `NPM_TOKEN`
---rule
npm ci
Still runs `npm ci`
---rule
!^(ARG|ENV)\s+NPM_TOKEN
No `ARG`/`ENV` for the token
---solution
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
COPY . .
CMD ["node", "server.js"]
:::

:::exercise
id: dp-buildx
level: 3
title: One tag, two architectures
mode: code
lang: bash
file: release.sh
---
Write the single command that builds the current directory for **both** `linux/amd64` and `linux/arm64`, tags it `ghcr.io/acme/api:2.0.0`, and pushes it.
---starter
#!/bin/sh
---rule
docker\s+buildx\s+build
Use `docker buildx build`
---rule
--platform[ =]linux/(amd64,linux/arm64|arm64,linux/amd64)
`--platform linux/amd64,linux/arm64`
---rule
-t\s+ghcr\.io/acme/api:2\.0\.0|--tag[ =]ghcr\.io/acme/api:2\.0\.0
Tag `ghcr.io/acme/api:2.0.0`
---rule
--push
Push the result
---rule
\s\.\s*$
Build context `.`
---solution
#!/bin/sh
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/acme/api:2.0.0 --push .
:::

:::exercise
id: dp-exit-137
level: 2
title: Read the exit code
mode: answer
---
`docker ps -a` shows a container as `Exited (137) 2 minutes ago`, and it was started with `--memory 64m`. In one word, what most likely killed it?
---answer
OOM
---answer
oom killer
---answer
OOM-killer
---answer
out of memory
---solution
OOM
---explain
137 = 128 + 9: the process got SIGKILL. With a tight memory limit, the kernel OOM killer is the usual sender. `docker inspect -f '{{.State.OOMKilled}}'` confirms it.
:::

:::exercise
id: dp-cpus-predict
level: 2
title: Throttled or killed?
mode: answer
---
A container runs with `--cpus 0.25` and its code enters a busy loop. Will it be **killed** or **throttled**?
---answer
throttled
---solution
throttled
---explain
CPU limits never kill; the scheduler just gives the container less CPU time.
:::

:::exercise
id: proj-dk-10-hardened
level: 3
title: "Project 10: run Taskboard hardened"
compare: verify
cwd: /home/student/taskboard
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile && docker build -q -t taskboard:prod . >/dev/null 2>&1
---
Run `taskboard:prod` in the background as `api` on port 8000 with: restart policy `unless-stopped`, memory **384m**, **1** CPU, a read-only root filesystem with a tmpfs at `/tmp`, and all capabilities dropped.
---verify
docker inspect -f '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}' api
curl -s localhost:8000/health
---solution
docker run -d --name api --restart unless-stopped --memory 384m --cpus 1 --read-only --tmpfs /tmp --cap-drop ALL -p 8000:8000 taskboard:prod
:::

:::exercise
id: proj-dk-10-size
level: 2
title: "Project 10b: choose a memory limit"
mode: answer
---
Under load testing, Taskboard's container peaks at **200 MB**. Following the "1.5–2× the observed peak" rule, which of these limits is most appropriate: `128m`, `256m`, `384m` or `2g`?
---answer
384m
---solution
384m
---explain
128m and 256m would OOM-kill at peak (256m leaves almost no headroom); 2g wastes capacity and hides leaks for longer.
:::
