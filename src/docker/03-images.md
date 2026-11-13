---
id: docker-images
title: Images, layers & tags
summary: What an image is made of, layers and sharing, tags vs digests, choosing base image variants, tagging, removing and pruning images, and pushing to a registry.
minutes: 25
---
## An image is a stack of layers

An image is an ordered stack of read-only **layers**. Each layer records filesystem changes: files added, modified or deleted. When a container starts, Docker stacks the image's layers and adds a thin **writable layer** on top (a union filesystem, usually overlay2).

```
 ┌───────────────────────────┐  container's writable layer (deleted with the container)
 ├───────────────────────────┤  COPY . .            ← your code
 ├───────────────────────────┤  RUN pip install ...  ← dependencies
 ├───────────────────────────┤  WORKDIR /app
 ├───────────────────────────┤  python:3.12-slim layers (shared with every image built FROM it)
 └───────────────────────────┘
```

Layers are **content-addressed** and **shared**: ten images built `FROM python:3.12-slim` store the base layers once. That's why pulling a second image is often fast ("Already exists").

## Tags and digests

A **tag** (`nginx:1.27`) is a movable name pointing at an image. A **digest** (`nginx@sha256:…`) identifies exact content and never moves. Several tags can point to the same image: `nginx:latest`, `nginx:1.27` and `nginx:1.27.2` may all be one image.

```bash run
docker pull nginx:latest
docker pull nginx:1.27
docker images nginx
```

Same IMAGE ID, two tags, one copy on disk.

> [!tip] Pinning
> For anything you deploy, pin at least the minor version (`python:3.12-slim`, `postgres:16`) so a rebuild next month doesn't silently jump a major version. Pin by digest when you need byte-for-byte reproducibility.

## Choosing a variant

Official images come in flavors. Size matters: it's download time, disk, and attack surface (fewer packages, fewer CVEs).

```bash run
docker pull python:3.12
docker pull python:3.12-slim
docker pull python:3.12-alpine
docker images python --format 'table {{.Tag}}\t{{.Size}}'
```

| Variant | Based on | Trade-off |
|---|---|---|
| `python:3.12` | full Debian + build tools | huge, but compiles anything |
| `python:3.12-slim` | minimal Debian | the usual sweet spot; lacks curl, compilers |
| `python:3.12-alpine` | Alpine (musl libc, `apk`) | tiny; some Python wheels don't work with musl and must compile |
| `eclipse-temurin:21-jdk` vs `21-jre` | JDK vs runtime only | build with the JDK, **run** with the JRE |

## Managing images

| Command | Does |
|---|---|
| `docker images` / `docker image ls` | list images |
| `docker pull NAME:TAG` | download |
| `docker tag SRC NEW` | add another name to an image (no copy) |
| `docker rmi NAME` | remove a tag; the image is deleted when its last tag goes |
| `docker history NAME` | show the layers and the instruction that made each |
| `docker image prune` | delete **dangling** images (`<none>:<none>`) |
| `docker image prune -a` | delete every image not used by a container |
| `docker system df` | disk usage summary |

```bash run
docker pull alpine
docker tag alpine:latest mybase:1.0
docker images
docker rmi mybase:1.0
docker images
```

`docker rmi` refuses to delete an image that a container (even a stopped one) uses. Remove the container first, or force with `-f`.

### Dangling images

When you rebuild an image with the same tag, the tag moves to the new image and the old one becomes `<none>:<none>`, a **dangling** image still taking space. `docker image prune` cleans them up.

## Pushing to a registry

To share an image, give it a name in **your** namespace, log in, and push:

```bash
docker login
docker tag myapp:latest yourname/myapp:1.0
docker push yourname/myapp:1.0
```

Anyone can then `docker pull yourname/myapp:1.0` (for a public repository).

:::quiz
q: Ten images are built FROM python:3.12-slim. How many copies of the base layers are stored?
+ One, shared by all ten
- Ten
- Two (one per variant)
- It depends on the tag
why: Layers are content-addressed and shared between images.
:::

:::quiz
q: What does `docker tag app:latest me/app:2.0` do?
- Copies the image
- Pushes to Docker Hub
+ Adds a second name pointing to the same image
- Renames and deletes the old tag
why: Tags are just pointers. Both names now show the same IMAGE ID.
:::

:::quiz
q: What is a dangling image?
- An image with no running containers
+ An untagged image (<none>:<none>), usually left behind when a tag moved to a newer build
- An image whose base was deleted
- An image that failed to build
why: Rebuilding with the same tag moves the tag; the previous image loses its name.
:::

:::quiz
q: Why is `-slim` often preferred over the full python image?
- It runs Python faster
+ It's much smaller (faster pulls, fewer packages to patch) while staying Debian-compatible
- It includes more build tools
- Alpine doesn't support Python
why: Smaller images mean faster deploys and a smaller attack surface; slim keeps glibc compatibility that Alpine lacks.
:::

:::quiz
q: Which reference never changes what it points to?
- nginx:latest
- nginx:1.27
+ nginx@sha256:3b7f…
- nginx:stable
why: Digests identify exact content. Tags can be moved by the publisher.
:::

:::exercise
id: di-variants
level: 1
title: Compare sizes
compare: verify
---
Pull `python:3.12-slim` and `python:3.12-alpine`.
---verify
docker images python --format '{{.Tag}} {{.Size}}'
---solution
docker pull python:3.12-slim
docker pull python:3.12-alpine
:::

:::exercise
id: di-tag
level: 1
title: Another name
compare: verify
setup: docker pull nginx >/dev/null 2>&1
---
`nginx:latest` is already pulled. Give it the additional name `mynginx:v1`.
---verify
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | sort
---solution
docker tag nginx:latest mynginx:v1
:::

:::exercise
id: di-rmi
level: 2
title: Free some space
compare: verify
setup: docker pull alpine >/dev/null 2>&1; docker pull busybox >/dev/null 2>&1; docker pull redis:7-alpine >/dev/null 2>&1
---
Three images are present. Remove `busybox` and `redis:7-alpine`, keeping `alpine`.
---verify
docker images --format '{{.Repository}}:{{.Tag}}'
---solution
docker rmi busybox redis:7-alpine
:::

:::exercise
id: di-rmi-in-use
level: 2
title: Image in use
compare: verify
setup: docker run --name tmp alpine echo done >/dev/null 2>&1
---
A stopped container named `tmp` was created from `alpine`. Delete the `alpine` image properly (without `-f`).
---hint
`docker rmi alpine` refuses while a container references the image. Remove the container first.
---verify
docker ps -a --format '{{.Names}}' | wc -l
docker images --format '{{.Repository}}' | wc -l
---solution
docker rm tmp
docker rmi alpine
:::

:::exercise
id: di-same-id
level: 2
title: Same image?
mode: answer
---
`docker images` shows `nginx latest 3b25b682ea82` and `nginx 1.27 3b25b682ea82`. How many copies of that image are stored on disk?
---answer
1
---answer
one
---solution
1
:::

:::exercise
id: di-filter
level: 2
title: Just the IDs
setup: docker pull alpine >/dev/null 2>&1; docker pull nginx:alpine >/dev/null 2>&1
---
Print only the IDs of all local images (one per line), the way you'd feed them to another command.
---solution
docker images -q
:::

:::exercise
id: di-push
level: 3
title: Publish your image
compare: verify
setup: mkdir -p ~/hello && cd ~/hello && printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py .\nCMD ["python", "app.py"]\n' > Dockerfile && docker build -q -t hello-py . >/dev/null 2>&1
---
A local image `hello-py:latest` exists. Log in, give it the name `student/hello-py:1.0`, and push it to the registry.
---verify
docker images --format '{{.Repository}}:{{.Tag}}' | grep student
docker rmi student/hello-py:1.0 >/dev/null && docker pull student/hello-py:1.0 | tail -1
---solution
docker login
docker tag hello-py student/hello-py:1.0
docker push student/hello-py:1.0
:::

:::exercise
id: di-prune
level: 3
title: Clean up dangling images
compare: verify
cwd: /home/student/hello
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py .\nCMD ["python", "app.py"]\n' > Dockerfile && docker build -q -t hello-py . >/dev/null 2>&1 && echo 'print("v2")' >> app.py && docker build -q -t hello-py . >/dev/null 2>&1
---
`hello-py` was built twice, so an old untagged image is left over. Remove dangling images without being asked for confirmation.
---verify
docker images --format '{{.Repository}}:{{.Tag}}' | sort
---solution
docker image prune -f
:::

:::exercise
id: di-latest-meaning
level: 1
title: What latest means
mode: answer
---
Fill in the blank with one word: the tag `latest` is used when you don't specify a ____.
---answer
tag
---solution
tag
:::

:::exercise
id: di-system-df
level: 3
title: Dangling count
setup: cd ~/hello && printf 'FROM alpine\nCOPY app.py .\n' > Dockerfile && docker build -q -t h . >/dev/null 2>&1 && echo '# 2' >> app.py && docker build -q -t h . >/dev/null 2>&1 && echo '# 3' >> app.py && docker build -q -t h . >/dev/null 2>&1; cd ~
---
`h` was rebuilt several times. Print the **number** of dangling images.
---hint
`docker images --filter dangling=true -q` lists them; count the lines.
---solution
docker images --filter dangling=true -q | wc -l
:::
