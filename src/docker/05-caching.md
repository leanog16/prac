---
id: docker-caching
title: Build cache, .dockerignore & multi-stage
summary: How the layer cache decides what to rebuild, ordering instructions for fast builds, keeping the build context lean and secret-free, shrinking layers, and multi-stage builds.
minutes: 35
---
## The cache rule

For each instruction, BuildKit computes a cache key from:

1. the **parent layer** (everything before it),
2. the **instruction text** itself, and
3. for `COPY`/`ADD`, a **checksum of the files** being copied.

If a matching layer exists, it's reused (`CACHED`). The moment one step misses, **every step after it rebuilds**, because their parent changed.

```bash run
cd fastapi-app
cat > Dockerfile <<'EOF'
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0"]
EOF
docker build -t api . > /dev/null
echo "# small code change" >> main.py
docker build -t api .
```

Only `COPY . .` reran. The slow `pip install` was cached because `requirements.txt` didn't change.

## Order from stable to volatile

Compare with the naive version:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir -r requirements.txt
```

Now **any** code change invalidates `COPY . .`, so pip reinstalls every dependency on every build. The rule of thumb:

1. base image, system packages (rarely change)
2. dependency manifests (`requirements.txt`, `package.json`, `pom.xml`) and the install step
3. application source (changes constantly)

## .dockerignore

`.dockerignore` (in the context root) lists files the build must not see. Three reasons to always have one:

- **Secrets**: `.env`, keys and credentials otherwise get copied into the image by `COPY . .`.
- **Cache stability**: junk that changes often (`__pycache__/`, `.git/`, `node_modules/`, `target/`) would bust the `COPY . .` cache.
- **Speed and size**: a smaller context uploads faster.

```
# .dockerignore
.env
.git
__pycache__/
*.pyc
tests/
Dockerfile
```

Patterns use glob syntax (`*`, `**`, `?`), relative to the context; `!pattern` re-includes.

## Fewer, cleaner layers

Each `RUN` is a layer, and **deleting files in a later layer doesn't shrink the earlier one**. Install and clean up in the *same* RUN:

```dockerfile
# leaves ~20 MB of apt lists baked into the first layer
RUN apt-get update
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*

# one layer, cleaned before it's committed
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
```

Same idea for pip: `pip install --no-cache-dir`.

## Multi-stage builds

Compilers, build tools and source code are needed to **build** an app but not to **run** it. A multi-stage Dockerfile builds in one stage and copies only the result into a small runtime stage:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

```bash run
cd spring-app
cat > Dockerfile <<'EOF'
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
EOF
docker build -q -t demo . > /dev/null
docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}'
```

The final image contains a JRE and one jar: no Maven, no JDK, no source, no 80 MB `~/.m2` cache. Only the **last** stage (or `--target NAME`) becomes the image.

> [!tip] Inspect what you built
> `docker history IMAGE` lists each layer with its size and the instruction that created it: the fastest way to find what's bloating an image.

:::quiz
q: A Dockerfile copies the whole project (`COPY . .`) and then runs `pip install -r requirements.txt`. You edit one line of main.py. What reruns?
- Nothing; only changed files are copied
- Only COPY . .
+ COPY . . and the pip install (and everything after)
- The whole build from FROM
why: The COPY's checksum changed, so it misses, and every later step has a new parent.
:::

:::quiz
q: Which file keeps `.env` out of `COPY . .`?
- .gitignore
+ .dockerignore
- docker-compose.yml
- Dockerfile.exclude
why: .dockerignore filters the build context sent to the builder. .gitignore has no effect on Docker.
:::

:::quiz
q: `RUN apt-get update` then a separate `RUN rm -rf /var/lib/apt/lists/*`. Is the image smaller afterwards?
- Yes, by the size of the lists
+ No; the files still exist in the earlier layer
- Only after docker image prune
- Only with --squash
why: Layers are additive. Clean up inside the same RUN that created the files.
:::

:::quiz
q: In a multi-stage build, what ends up in the final image?
- every stage, layered together
+ only the last stage (or the --target stage), plus whatever it COPY --from'd
- only the first stage
- the build stage's cache
why: Earlier stages are discarded unless their files are explicitly copied.
:::

:::quiz
q: What's in a layer's cache key for COPY?
- only the instruction text
- the timestamp of the build
+ the parent layer, the instruction, and a checksum of the copied files
- the image tag
why: Changing file contents (not timestamps) busts the cache.
:::

:::exercise
id: dc-order
level: 2
title: Cache-friendly order
mode: file
file: Dockerfile
cwd: /home/student/fastapi-app
---run
docker build -q -t api . >/dev/null
echo "# code change" >> main.py
docker build -t api . | grep -c 'CACHED.*pip install'
---
Write a Dockerfile for `~/fastapi-app` (base `python:3.12-slim`, workdir `/app`, uvicorn CMD on `0.0.0.0`) ordered so that editing `main.py` does **not** re-run `pip install`. The grader builds, edits `main.py`, rebuilds, and counts cached pip steps (it should print `1`).
---hint
Copy `requirements.txt` and install **before** copying the rest of the source.
---solution
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: dc-ignore
level: 2
title: Keep secrets out
mode: file
file: .dockerignore
cwd: /home/student/fastapi-app
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0"]\n' > ~/fastapi-app/Dockerfile
run: docker build -q -t api . >/dev/null && docker run --rm api ls -A /app
---
The Dockerfile in `~/fastapi-app` does `COPY . .`, which currently copies `.env` (secrets!), `__pycache__/` and `tests/` into the image. Write a `.dockerignore` so the image's `/app` contains only `.dockerignore`, `Dockerfile`, `main.py` and `requirements.txt`.
---solution
.env
__pycache__/
tests/
:::

:::exercise
id: dc-ignore-more
level: 3
title: Leaner still
mode: file
file: .dockerignore
cwd: /home/student/fastapi-app
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD ["python", "-c", "print(1)"]\n' > ~/fastapi-app/Dockerfile
run: docker build -q -t api . >/dev/null && docker run --rm api ls -A /app
---
Write a `.dockerignore` that leaves **only** `main.py` and `requirements.txt` in the image (the Dockerfile itself and `.dockerignore` too should be excluded). Use exclusion patterns plus `!` re-includes, or list everything else.
---hint
Exclude everything with `*`, then re-include with `!main.py` and `!requirements.txt`.
---solution
*
!main.py
!requirements.txt
:::

:::exercise
id: dc-one-run
level: 3
title: One clean layer
mode: file
file: Dockerfile
cwd: /home/student/hello
---run
docker build -q -t tools . >/dev/null
docker run --rm tools ls /usr/bin/curl
docker run --rm tools ls /var/lib/apt/lists | wc -l
docker history --format '{{.CreatedBy}}' tools | grep -c '^RUN'
---
Write a Dockerfile from `debian:bookworm-slim` that installs `curl` with apt **in a single RUN instruction** that also deletes `/var/lib/apt/lists/*` afterwards. The grader checks curl exists, the lists are gone, and there's exactly one RUN layer.
---hint
`apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*`
---solution
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
:::

:::exercise
id: dc-multistage
level: 3
title: Multi-stage Spring Boot
mode: file
file: Dockerfile
cwd: /home/student/spring-app
---run
docker build -q -t demo . >/dev/null
docker run -d -p 8080:8080 demo >/dev/null
curl -s localhost:8080/api/status; echo
docker images demo --format '{{.Size}}'
docker run --rm --entrypoint ls demo /app
---
Write a two-stage Dockerfile for `~/spring-app`:

1. stage `build` from `maven:3.9-eclipse-temurin-21`, workdir `/src`: copy `pom.xml` and `src`, run `mvn -q package -DskipTests`
2. final stage from `eclipse-temurin:21-jre`, workdir `/app`: copy **only** the jar from the build stage as `app.jar`, and start it with `java -jar app.jar` as the ENTRYPOINT.
---solution
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
:::

:::exercise
id: dc-nocache
level: 2
title: Force a clean rebuild
cwd: /home/student/hello
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py .\nCMD ["python", "app.py"]\n' > Dockerfile && docker build -q -t hello . >/dev/null 2>&1
---
`hello` was already built, so a rebuild would be fully cached. Rebuild it **ignoring the cache**, piping the build output through `grep -c CACHED` to prove nothing was cached (it should print `0`).
---solution
docker build --no-cache -t hello . | grep -c CACHED
:::

:::exercise
id: dc-history
level: 2
title: Who made this layer?
cwd: /home/student/hello
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py .\nCMD ["python", "app.py"]\n' > Dockerfile && docker build -q -t hello . >/dev/null 2>&1
---
Print the `CreatedBy` instruction of every layer of the `hello` image, newest first, one per line, using `docker history` with a format string.
---solution
docker history --format '{{.CreatedBy}}' hello
:::

:::exercise
id: dc-target
level: 3
title: Stop at a stage
cwd: /home/student/spring-app
setup: printf 'FROM maven:3.9-eclipse-temurin-21 AS build\nWORKDIR /src\nCOPY pom.xml .\nCOPY src ./src\nRUN mvn -q package -DskipTests\n\nFROM eclipse-temurin:21-jre\nWORKDIR /app\nCOPY --from=build /src/target/*.jar app.jar\nENTRYPOINT ["java", "-jar", "app.jar"]\n' > Dockerfile
---
The two-stage Dockerfile in `~/spring-app` names its first stage `build`. Build **only** that stage, tagged `demo-build`, quietly (`-q`, output discarded), and then list what's in `/src/target` inside it with `docker run --rm demo-build ls /src/target`.
---hint
`--target build`
---solution
docker build -q --target build -t demo-build . >/dev/null
docker run --rm demo-build ls /src/target
:::

:::exercise
id: dc-which-step
level: 3
title: First step to rebuild
mode: answer
---
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY src ./src
RUN npm run build
CMD ["node", "dist/server.js"]
```

You change a file in `src/` and rebuild. Which instruction is the **first** one that is not cached? (Answer with the instruction, e.g. `RUN npm install`.)
---answer
COPY src ./src
---solution
COPY src ./src
:::

:::exercise
id: dc-how-many
level: 3
title: How many rebuild?
mode: answer
---
Same Dockerfile as the previous exercise. This time you add a dependency to `package.json`. How many of the 6 instructions after `FROM` are re-executed (not cached)?
---answer
5
---hint
Find the first miss; everything after it rebuilds.
---solution
5
---explain
`WORKDIR` is cached; `COPY package.json .` misses, and the 4 steps after it rebuild too: 5 in total.
:::
