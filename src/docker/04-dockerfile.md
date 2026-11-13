---
id: docker-dockerfile
title: Writing Dockerfiles
summary: The Dockerfile instructions you'll use every day, the build context, CMD vs ENTRYPOINT and exec vs shell form, ARG vs ENV, running as a non-root user, and labels.
minutes: 40
---
> [!project] Taskboard, step 4: the first Dockerfile
> This is the core step of the track: writing `~/taskboard/Dockerfile`, building the image, running it, and calling the API from the host.

## A Dockerfile is a recipe

A **Dockerfile** lists instructions that build an image, starting from a base image. `docker build` executes them in order; most instructions produce a layer.

```dockerfile
# start from a base image
FROM python:3.12-slim
# cd into /app (creating it)
WORKDIR /app
# copy from the build context into the image
COPY requirements.txt .
# run a command at BUILD time
RUN pip install --no-cache-dir -r requirements.txt
# copy the rest of the source
COPY . .
# environment variable for build AND run time
ENV APP_ENV=production
# document the port (doesn't publish it!)
EXPOSE 8000
# default command at RUN time
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

> [!warn] Comments go on their own line
> In a Dockerfile, `#` only starts a comment at the beginning of a line. `FROM python:3.12-slim # base` passes `#` and `base` as extra arguments and fails.

| Instruction | Purpose | Layer? |
|---|---|---|
| `FROM image[:tag] [AS name]` | base image; starts a build stage | — |
| `WORKDIR /path` | set (and create) the working directory | yes (tiny) |
| `COPY src... dest` | copy files from the build context (or another stage) | yes |
| `ADD` | like COPY, plus URLs and auto-extracting tarballs; prefer COPY | yes |
| `RUN cmd` | run a command while building (install packages, compile) | yes |
| `ENV KEY=value` | env var present at build and run time | metadata |
| `ARG NAME[=default]` | build-time variable (`--build-arg`), not in the final environment | metadata |
| `EXPOSE 8000` | documents the listening port | metadata |
| `USER name` | run following instructions and the container as this user | metadata |
| `CMD [...]` | default command (overridable at `docker run`) | metadata |
| `ENTRYPOINT [...]` | the executable; CMD becomes its default arguments | metadata |
| `LABEL key=value` | metadata (maintainer, version, source) | metadata |
| `HEALTHCHECK CMD ...` | how Docker checks the app is healthy | metadata |
| `VOLUME /path` | declare a mount point for data | metadata |

## Build it

```
docker build -t NAME[:TAG] [-f Dockerfile] CONTEXT
```

The **build context** (usually `.`) is the directory whose files `COPY` can see. Paths in `COPY` are relative to the context, never outside it.

```bash run
cd hello
cat app.py
cat > Dockerfile <<'EOF'
FROM python:3.12-slim
WORKDIR /app
COPY app.py .
CMD ["python", "app.py"]
EOF
docker build -t hello-py .
docker run --rm hello-py
```

> [!warn] RUN vs CMD
> `RUN` executes **during the build** and bakes its results into the image. `CMD` is stored and executed **each time a container starts**. `RUN python app.py` would run your program once, at build time, which is almost never what you want.

## Exec form vs shell form

```dockerfile
# exec form: a JSON array, runs the program directly
CMD ["python", "app.py"]
# shell form: runs /bin/sh -c "python app.py"
CMD python app.py
```

Prefer **exec form** for CMD and ENTRYPOINT: your program becomes PID 1 and receives signals (so `docker stop` shuts it down gracefully). Shell form is handy when you need variable expansion or `&&`, but then a shell does the expanding:

```dockerfile
# prints the literal text $HOME (no shell!)
CMD ["echo", "$HOME"]
# prints /root
CMD echo $HOME
```

## CMD vs ENTRYPOINT

- `CMD` alone: the default command; `docker run IMAGE other command` **replaces** it.
- `ENTRYPOINT` + `CMD`: ENTRYPOINT is the fixed executable, CMD supplies **default arguments** that `docker run IMAGE args` replaces.

```bash run
mkdir greeter && cd greeter
cat > Dockerfile <<'EOF'
FROM alpine
ENTRYPOINT ["echo", "Hello,"]
CMD ["world"]
EOF
docker build -q -t greeter . > /dev/null
docker run --rm greeter
docker run --rm greeter Docker learners
```

This "the image is a command" pattern is common for CLI tools.

## ARG vs ENV

```dockerfile
# set with: docker build --build-arg APP_VERSION=1.4.0
ARG APP_VERSION=dev
# copy it into the runtime environment if the app needs it
ENV APP_VERSION=${APP_VERSION}
```

`ARG` exists only during the build. `ENV` persists into running containers (and can be overridden with `docker run -e`). **Never put secrets in either**: both are visible in `docker history` and `docker inspect`.

## Run as a non-root user

By default the container's process runs as root. If the app is compromised, root in the container is far closer to root on the host than it should be. Create a user and switch to it:

```dockerfile
RUN useradd --create-home appuser
USER appuser
```

```bash run
mkdir who && cd who
printf 'FROM python:3.12-slim\nRUN useradd -m appuser\nUSER appuser\nCMD ["whoami"]\n' > Dockerfile
docker build -q -t who . >/dev/null
docker run --rm who
```

## Worked example: a Dockerfile line by line

```dockerfile title=taskboard/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

| Line | Does | Why |
|---|---|---|
| `FROM python:3.12-slim` | start from the base image | Python preinstalled |
| `WORKDIR /app` | create and `cd` into `/app` | everything after is relative to it |
| `COPY requirements.txt .` | copy just the dependency list | so the next layer can be cached (next lesson) |
| `RUN pip install …` | runs **at build time**, result saved in the image | `--no-cache-dir` keeps pip's download cache out of the image |
| `COPY . .` | copy the rest of the source | |
| `EXPOSE 8000` | documentation: "this app listens on 8000" | doesn't publish anything by itself |
| `CMD [...]` | the default command **at run time** | exec form: uvicorn becomes PID 1 and receives stop signals |

`--host 0.0.0.0` is essential: uvicorn's default `127.0.0.1` would only accept connections from **inside** the container, so `-p 8000:8000` would lead nowhere.

Build and run it:

```bash
cd taskboard
docker build -t taskboard:dev .
docker run -d --name api -p 8000:8000 taskboard:dev
curl -s localhost:8000/health
```

> [!plain] In plain English
> A Dockerfile is a recipe. `docker build` follows it once and saves the result as an image. `RUN` happens while baking; `CMD` is what happens every time a container starts.

## RUN vs CMD vs ENTRYPOINT

- `RUN` executes during the **build**: installing packages, compiling.
- `CMD` is the default **runtime** command, easy to override: `docker run taskboard:dev pytest` runs the tests instead of the server.
- `ENTRYPOINT` is the fixed executable; `CMD` then supplies default **arguments** to it. Use it for images that behave like a single command-line tool.

## Common mistakes

> [!mistake] Shell-form CMD
> `CMD uvicorn main:app` runs under `/bin/sh -c`, so the shell is PID 1 and `docker stop` signals reach the shell, not uvicorn. The container takes 10 seconds to stop, then gets killed. Use the JSON exec form.

> [!mistake] `COPY . .` copying secrets
> Right now this Dockerfile copies `.env` (with the secret key) into the image. The next lesson fixes that with `.dockerignore`.

:::quiz
q: When does a RUN instruction execute?
+ Once, during docker build; its result is saved in a layer
- Every time a container starts
- Only when the container is stopped
- When the image is pushed
why: RUN is build-time. CMD/ENTRYPOINT are run-time.
:::

:::quiz
q: The image has `ENTRYPOINT ["ping"]` and `CMD ["localhost"]`. What does `docker run img example.com` run?
- `example.com`
+ `ping example.com`
- `ping localhost example.com`
- `ping localhost`
why: Arguments after the image replace CMD, which supplies arguments to the ENTRYPOINT.
:::

:::quiz
q: Does `EXPOSE 8000` make the app reachable at localhost:8000 on your machine?
- Yes, automatically
+ No, it only documents the port; you still need -p (or -P) at run time
- Only on Linux
- Only with docker compose
why: EXPOSE is metadata. Publishing happens with -p HOST:CONTAINER.
:::

:::quiz
q: Which is visible to someone who has your image?
- ARG values only
- ENV values only
+ Both ARG and ENV values (via docker history / inspect)
- Neither
why: Build args used in instructions and env vars are recorded in image metadata. Use build secrets or runtime injection for credentials.
:::

:::quiz
q: Why prefer `CMD ["python", "app.py"]` over `CMD python app.py`?
- It's faster to build
+ The program runs directly as PID 1 and receives signals like SIGTERM from docker stop
- Shell form isn't supported anymore
- It allows variable expansion
why: Shell form wraps your program in /bin/sh -c, and sh doesn't forward signals, so docker stop waits 10 s and then kills it.
:::

:::exercise
id: df-hello
level: 1
title: Containerize a script
mode: file
file: Dockerfile
cwd: /home/student/hello
run: docker build -q -t hello . >/dev/null && docker run --rm hello
---
In `~/hello` there's an `app.py`. Write a Dockerfile that uses `python:3.12-slim`, sets the working directory to `/app`, copies `app.py` in, and runs it with `python app.py` (exec form).
---hint
Four instructions: FROM, WORKDIR, COPY, CMD.
---solution
FROM python:3.12-slim
WORKDIR /app
COPY app.py .
CMD ["python", "app.py"]
:::

:::exercise
id: df-static
level: 1
title: Ship a static site
mode: file
file: Dockerfile
cwd: /home/student/site
run: docker build -q -t site . >/dev/null && docker run -d -p 8080:80 site >/dev/null && curl -s localhost:8080/about.html
---
`~/site` holds a small website (`index.html`, `about.html`, `css/`). Write a Dockerfile based on `nginx:alpine` that copies the site into nginx's web root, `/usr/share/nginx/html/`.
---hint
`COPY . /usr/share/nginx/html/` copies the context's contents. nginx's own CMD already starts the server.
---solution
FROM nginx:alpine
COPY . /usr/share/nginx/html/
:::

:::exercise
id: df-workdir-check
level: 2
title: Where am I?
mode: file
file: Dockerfile
cwd: /home/student/hello
run: docker build -q -t pwd-img . >/dev/null && docker run --rm pwd-img
---
Write a Dockerfile from `alpine` whose working directory is `/srv/app` and whose default command (exec form) is `pwd`, so running the image prints `/srv/app`.
---solution
FROM alpine
WORKDIR /srv/app
CMD ["pwd"]
:::

:::exercise
id: df-entrypoint
level: 2
title: The image is a command
mode: file
file: Dockerfile
cwd: /home/student/hello
---run
docker build -q -t shout . >/dev/null
docker run --rm shout
docker run --rm shout custom text here
---
Build an `alpine` image that runs `echo` with the default argument `hello from shout`, so that `docker run shout` prints `hello from shout`, while `docker run shout custom text here` prints `custom text here`.
---hint
ENTRYPOINT is the fixed part, CMD the replaceable default arguments.
---solution
FROM alpine
ENTRYPOINT ["echo"]
CMD ["hello from shout"]
:::

:::exercise
id: df-env
level: 2
title: Configurable greeting
mode: file
file: Dockerfile
cwd: /home/student/hello
setup: printf 'import os\nprint(f"{os.environ.get(\x27GREETING\x27, \x27Hello\x27)}, Docker!")\n' > greet.py
---run
docker build -q -t greet . >/dev/null
docker run --rm greet
docker run --rm -e GREETING=Hola greet
---
`~/hello/greet.py` prints `{GREETING}, Docker!` using the `GREETING` environment variable. Write a Dockerfile (`python:3.12-slim`, workdir `/app`) that copies `greet.py`, sets `GREETING` to `Howdy` **by default**, and runs the script. Running with `-e GREETING=Hola` must still override it.
---solution
FROM python:3.12-slim
WORKDIR /app
COPY greet.py .
ENV GREETING=Howdy
CMD ["python", "greet.py"]
:::

:::exercise
id: df-fastapi
level: 3
title: Containerize the FastAPI app
mode: file
file: Dockerfile
cwd: /home/student/fastapi-app
---run
docker build -q -t api . >/dev/null
docker run -d --name api -p 8000:8000 api >/dev/null
curl -s localhost:8000/health
---
Write a Dockerfile for `~/fastapi-app` (`main.py`, `requirements.txt`):

- base `python:3.12-slim`, workdir `/app`
- copy `requirements.txt` first and `pip install --no-cache-dir -r requirements.txt`
- then copy the rest of the source
- document port 8000
- start with `uvicorn main:app --host 0.0.0.0 --port 8000` (exec form)
---hint
Without `--host 0.0.0.0`, uvicorn only listens on 127.0.0.1 *inside* the container and the published port can't reach it.
---solution
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: df-spring-single
level: 3
title: Build Spring Boot inside Docker
mode: file
file: Dockerfile
cwd: /home/student/spring-app
---run
docker build -q -t demo . >/dev/null
docker run -d -p 8080:8080 demo >/dev/null
curl -s "localhost:8080/hello?name=Docker"
---
Write a single-stage Dockerfile for `~/spring-app` using `maven:3.9-eclipse-temurin-21`: workdir `/app`, copy `pom.xml` and `src`, run `mvn package -DskipTests`, and start the jar `target/demo-0.0.1-SNAPSHOT.jar` with `java -jar`.
---hint
`COPY src ./src` keeps the directory structure Maven expects.
---solution
FROM maven:3.9-eclipse-temurin-21
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn package -DskipTests
CMD ["java", "-jar", "target/demo-0.0.1-SNAPSHOT.jar"]
:::

:::exercise
id: df-nonroot
level: 3
title: Drop root
mode: file
file: Dockerfile
cwd: /home/student/hello
run: docker build -q -t safe . >/dev/null && docker run --rm safe
---
Write a Dockerfile from `python:3.12-slim` that creates a user named `appuser` (with `useradd -m`), switches to it, and whose default command is `whoami`.
---solution
FROM python:3.12-slim
RUN useradd -m appuser
USER appuser
CMD ["whoami"]
:::

:::exercise
id: df-arg
level: 3
title: Stamp the version
mode: file
file: Dockerfile
cwd: /home/student/hello
---run
docker build -q --build-arg APP_VERSION=1.2.3 -t ver . >/dev/null
docker run --rm ver
docker build -q -t ver-default . >/dev/null
docker run --rm ver-default
---
Write a Dockerfile from `alpine` with a build argument `APP_VERSION` defaulting to `dev`, copied into an environment variable of the same name, and a **shell-form** CMD that prints `version $APP_VERSION`.
---hint
`ARG APP_VERSION=dev`, then `ENV APP_VERSION=${APP_VERSION}`, then `CMD echo "version $APP_VERSION"`.
---solution
FROM alpine
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
CMD echo "version $APP_VERSION"
:::

:::exercise
id: df-labels
level: 3
title: Metadata
mode: file
file: Dockerfile
cwd: /home/student/site
run: docker build -q -t site . >/dev/null && docker inspect -f '{{index .Config.Labels "maintainer"}} {{json .Config.ExposedPorts}}' site
---
Write a Dockerfile from `nginx:alpine` that copies the site to `/usr/share/nginx/html/`, adds the label `maintainer=student@ncsu.example`, and documents port `80`.
---solution
FROM nginx:alpine
LABEL maintainer=student@ncsu.example
COPY . /usr/share/nginx/html/
EXPOSE 80
:::

:::exercise
id: df-exec-form-predict
level: 2
title: Exec form, no shell
mode: answer
---
An image built from `alpine` has `CMD ["echo", "$HOME"]`. What does `docker run --rm img` print?
---answer
$HOME
---solution
$HOME
---explain
Exec form runs `echo` directly, with no shell to expand `$HOME`, so it prints the literal text.
:::

:::exercise
id: df-shell-form-predict
level: 2
title: Shell form expands
mode: answer
---
Same image, but with `CMD echo $HOME` (shell form). The container runs as root. What does it print?
---answer
/root
---solution
/root
:::

:::exercise
id: df-cmd-override
level: 2
title: Override the default
mode: answer
---
An image has `ENTRYPOINT ["python", "manage.py"]` and `CMD ["runserver"]`. What full command runs for `docker run img migrate`?
---answer
python manage.py migrate
---solution
python manage.py migrate
:::

:::exercise
id: df-copy-dir
level: 4
title: COPY copies contents
mode: answer
---
The build context has `site/index.html` and `site/css/style.css`. With `WORKDIR /web` and `COPY site .`, what is the path of `style.css` inside the image?
---answer
/web/css/style.css
---hint
When the source is a directory, COPY copies its **contents**, not the directory itself.
---solution
/web/css/style.css
:::

:::exercise
id: proj-dk-04-dockerfile
level: 3
title: "Project 4: Taskboard's Dockerfile"
mode: file
file: Dockerfile
cwd: /home/student/taskboard
---run
docker build -q -t taskboard . >/dev/null
docker run -d --name api -p 8000:8000 taskboard >/dev/null
curl -s localhost:8000/health; echo
curl -s localhost:8000/tasks/5; echo
---
Write `~/taskboard/Dockerfile`: start from `python:3.12-slim`, work in `/app`, copy `requirements.txt` and install it with pip (no cache), copy the rest, document port 8000, and start `uvicorn main:app` on host `0.0.0.0`, port `8000`, in exec form.
---solution
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
:::

:::exercise
id: proj-dk-04-run-tests
level: 3
title: "Project 4b: run the tests in the image"
compare: verify
cwd: /home/student/taskboard
setup: printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n' > Dockerfile
---
Build the image as `taskboard:dev` from `~/taskboard`, then run a **throwaway** container from it that lists the `/app/tests` directory instead of starting the server (override the command).
---verify
docker images --format '{{.Repository}}:{{.Tag}}' | grep taskboard
docker run --rm taskboard:dev ls /app/tests
---solution
docker build -t taskboard:dev .
docker run --rm taskboard:dev ls /app/tests
:::
