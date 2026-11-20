---
id: docker-intro
title: Containers & images
summary: What problem Docker solves, how containers differ from virtual machines, images vs containers, registries and image names, and your first docker run.
minutes: 25
---
> [!project] Track project: shipping Taskboard
> In the FastAPI track you built **Taskboard**, a task-tracking API. A copy lives in `~/taskboard` here: `main.py`, `requirements.txt`, tests, and a `.env` file with development secrets. Over this track you'll package it into an image, give it a PostgreSQL database, wire everything with Compose, and harden it for production. Each lesson's **Project** exercises run in the Docker simulator, so you'll see real output.

> [!note] Before you start
> Docker is driven from the command line. This track assumes the basics from the Bash track's first five lessons: running commands with options, `;` and `&&` between commands, pipes (`|`), quoting, and `>` to save output to a file. A few more tools appear along the way and are explained where they're first used.

## "Works on my machine"

An application never runs alone. It needs a specific language runtime, libraries at specific versions, system packages, config files and environment variables. Differences between your laptop, a teammate's laptop, CI and production are where bugs hide.

**Docker packages an application together with everything it needs to run** into a single artifact, an **image**, and runs it in an isolated environment, a **container**, that makes its runtime more consistent across compatible Docker hosts. Kernel, architecture and host configuration can still matter.

## Containers vs virtual machines

| | Virtual machine | Container |
|---|---|---|
| Isolation | a full guest OS on a hypervisor | processes isolated by the host kernel (namespaces, cgroups) |
| Kernel | its own | **shares the host's** |
| Startup | tens of seconds | milliseconds |
| Size | gigabytes | megabytes |
| Typical density | a handful per host | dozens to hundreds per host |

A container is just a process (or a few) on the host, with its own view of the filesystem, network and process list. That's why it's fast and light, and also why a Linux container needs a Linux kernel (Docker Desktop on macOS and Windows quietly runs a small Linux VM for you).

## Images and containers

| | Image | Container |
|---|---|---|
| What it is | a read-only template: filesystem snapshot + metadata (default command, env vars, ports) | a running (or stopped) **instance** of an image, with its own writable layer |
| Analogy | a class | an object |
| Created by | `docker build` or `docker pull` | `docker run` (or `docker create`) |
| Listed by | `docker images` | `docker ps -a` |

You can start many containers from one image. Changes a container makes to its filesystem live in that container's writable layer and disappear when the container is removed, unless you use volumes (a later module).

## Registries and image names

Images are distributed through **registries**. Docker Hub (`docker.io`) is the default; GitHub (`ghcr.io`), AWS ECR, Google Artifact Registry and private registries work the same way.

A full image reference looks like:

```
registry/namespace/repository:tag
docker.io/library/nginx:1.27-alpine
```

- Omit the registry and Docker assumes `docker.io`.
- Official images live in the `library` namespace, which you can also omit: `nginx` means `docker.io/library/nginx`.
- Omit the tag and Docker assumes **`latest`**, which is just a tag name, not a guarantee of "newest".
- Your own images on Docker Hub are `yourname/app:1.0`.

## Your first container

```bash run
docker run hello-world
```

Read what happened (the gray stderr lines in a real terminal):

1. The client asked the daemon to run `hello-world`.
2. The image wasn't on this machine, so the daemon **pulled** it from Docker Hub.
3. The daemon **created a container** from the image and started its default command.
4. The program printed its message and exited, so the container stopped.

Now something more useful: run a single command in a tiny Alpine Linux container.

```bash run
docker run alpine echo "Hello from a container"
docker run alpine cat /etc/os-release
```

Anything after the image name **replaces the image's default command**.

```bash run
docker run alpine echo first
docker run alpine echo second
docker ps -a
```

Every `docker run` created a *new* container; stopped ones stick around (`docker ps -a` shows them) until removed. `--rm` removes the container automatically when it exits, which is what you want for one-off commands.

> [!note] The Docker on this site
> Commands here run against a **simulated Docker engine** inside the in-browser shell: images, layers and build caching, containers, logs, exec, ports with `curl`, volumes, networks and Compose all behave like the real thing, deterministically, so exercises can be graded. Base images (alpine, ubuntu, debian, nginx, python, node, eclipse-temurin, maven, postgres, redis, hello-world) are "pulled" instantly. Try anything in the [Docker terminal](#docker-terminal).

## The architecture in one picture

```
 you ──> docker CLI ──REST API──> dockerd (daemon) ──> containerd ──> runc ──> your process
                                        │
                                        └──> registry (pull / push images)
```

The `docker` command is only a client. The daemon does the work: it stores images, manages containers, networks and volumes. That's why `docker ps` can show containers you didn't start from this terminal.

## Worked example: what problem is Docker solving for Taskboard?

Without containers, running Taskboard on a new machine means:

1. installing the right Python version (3.12, not the 3.9 the server came with),
2. creating a virtualenv and installing exact dependency versions,
3. installing and configuring PostgreSQL,
4. setting environment variables,
5. hoping the OS packages match your laptop's.

Each step is a chance for "works on my machine". With Docker, steps 1–2 and 4 are captured in an **image** that's identical everywhere, and step 3 is `docker run postgres:16`. A new teammate runs one command.

```bash run
ls -a taskboard
docker run --rm python:3.12-slim python --version
```

That second command downloaded (pulled) a Python image, started a container from it, ran `python --version` inside, printed the result and deleted the container (`--rm`). Your machine's own Python wasn't involved at all.

> [!plain] In plain English
> An **image** is a frozen package: an operating-system filesystem plus your app and its dependencies. A **container** is a running copy of an image, isolated from other processes. One image can run as many containers.

## Common mistakes

> [!mistake] Thinking containers persist changes
> Anything a container writes to its own filesystem disappears when the container is removed. Data you care about goes in **volumes** (lesson 6).

:::quiz
q: What does a container share with its host that a virtual machine does not?
- The CPU architecture only
+ The operating system kernel
- Nothing; they're equally isolated
- The host's filesystem
why: Containers are isolated processes on the host kernel. VMs run their own kernel on virtualized hardware.
:::

:::quiz
q: `docker run nginx` with no tag uses which tag?
- the newest version on Docker Hub
+ `latest`
- `stable`
- it's an error
why: The default tag is literally named latest. It points wherever the publisher last pointed it, which is why production should pin explicit tags.
:::

:::quiz
q: You run `docker run alpine echo hi` three times. How many containers now exist (running or stopped)?
- 0
- 1
+ 3
- it depends on whether alpine was already pulled
why: Each docker run creates a new container. They stop after echo exits but remain until removed (use --rm to auto-remove).
:::

:::quiz
q: Which statement about images and containers is right?
- A container is a read-only template
+ One image can be the source of many containers
- Deleting a container deletes its image
- docker images lists running containers
why: Images are read-only templates; containers are instances with their own writable layer.
:::

:::quiz
q: In `ghcr.io/acme/billing:2.3.1`, what is `acme`?
- the registry
+ the namespace (account or organization)
- the tag
- the repository
why: registry ghcr.io, namespace acme, repository billing, tag 2.3.1.
:::

:::exercise
id: dk-hello
level: 1
title: Hello, Docker
---
Run the `hello-world` image.
---solution
docker run hello-world
:::

:::exercise
id: dk-echo
level: 1
title: One-off command
---
Run an `alpine` container that prints `Hello from a container`.
---solution
docker run alpine echo "Hello from a container"
:::

:::exercise
id: dk-pull-tag
level: 1
title: Pull a specific tag
compare: verify
---
Download the `alpine` image with tag `3.20` without running it.
---verify
docker images --format '{{.Repository}}:{{.Tag}}'
---solution
docker pull alpine:3.20
:::

:::exercise
id: dk-os-release
level: 2
title: Which distro is this?
compare: both
---
Print the contents of `/etc/os-release` from inside an `ubuntu` container, and make sure the container is removed afterwards.
---verify
docker ps -a -q | wc -l
---solution
docker run --rm ubuntu cat /etc/os-release
---explain
The verify step confirms no stopped container was left behind thanks to `--rm`.
:::

:::exercise
id: dk-rm-flag
level: 2
title: Leave no trace
compare: both
---
Run `ls /` in an `alpine` container in a way that leaves **no** container behind afterwards.
---verify
docker ps -a --format '{{.Names}}' | wc -l
---solution
docker run --rm alpine ls /
:::

:::exercise
id: dk-pull-several
level: 2
title: Stock the image cache
compare: verify
---
Pull `nginx:alpine`, `redis:7-alpine` and `python:3.12-slim`.
---verify
docker images --format '{{.Repository}}:{{.Tag}}' | sort
---solution
docker pull nginx:alpine
docker pull redis:7-alpine
docker pull python:3.12-slim
:::

:::exercise
id: dk-count-containers
level: 2
title: How many containers?
mode: answer
---
Starting from a clean machine, you run:

```bash
docker run alpine echo one
docker run --rm alpine echo two
docker run alpine echo three
docker run --rm alpine echo four
```

How many containers does `docker ps -a` list afterwards?
---answer
2
---solution
2
---explain
Only the two runs without `--rm` leave stopped containers behind.
:::

:::exercise
id: dk-name-parts
level: 1
title: Read an image reference
mode: answer
---
In the image reference `docker.io/library/python:3.12-slim`, what is the **tag**?
---answer
3.12-slim
---solution
3.12-slim
:::

:::exercise
id: dk-default-ref
level: 2
title: Fully qualified
mode: answer
---
Write the fully qualified reference (registry, namespace, repository and tag) that `docker pull redis` actually pulls.
---answer
docker.io/library/redis:latest
---hint
Default registry, default namespace for official images, default tag.
---solution
docker.io/library/redis:latest
:::

:::exercise
id: dk-override-cmd
level: 3
title: Replace the default command
---
The `python:3.12-slim` image's default command starts a Python REPL. Run it so that instead it prints the Python version with `python3 --version`, removing the container afterwards.
---solution
docker run --rm python:3.12-slim python3 --version
:::

:::exercise
id: proj-dk-01-python
level: 1
title: "Project 1: which Python will Taskboard get?"
path: ops/docker/01-python.sh
---
Taskboard needs Python 3.12. Run a **throwaway** container from `python:3.12-slim` that prints the Python version.
---solution
docker run --rm python:3.12-slim python --version
:::

:::exercise
id: proj-dk-01-explore
level: 2
title: "Project 1b: look inside the base image"
path: ops/docker/01-explore.sh
---
Run a throwaway `python:3.12-slim` container that lists the contents of `/usr/local/bin` (where Python and pip are installed).
---solution
docker run --rm python:3.12-slim ls /usr/local/bin
:::
