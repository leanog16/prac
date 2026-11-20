# prac.

A study site with lessons, quizzes and auto-graded exercises for nine tracks: **SQL, Bash, Docker, FastAPI, Spring Boot, CI/CD, AWS, Java OOP and System Design**.

One project runs through every module of every track: **Taskboard**, a task tracker for small teams. Each module's exercises with the **Project** badge add a piece of it, and each piece is saved as a file in the learner's Taskboard repo (`#project` shows the build and the repo, and downloads it as a zip). Project steps require an account: their work is stored server-side under the `project` data key.

| Track | What it builds for Taskboard | Repo folder |
|---|---|---|
| SQL | the Monday team report on Taskboard's database (`members`, `boards`, `tasks`, `comments`, `labels`, `task_labels`) | `db/` |
| Bash | `logwatch`, the toolkit for Taskboard's server logs | `ops/` |
| FastAPI | the API in Python (the first module teaches the Python it needs) | `app/`, `tests/` |
| Docker | the image, the Compose stack and production hardening | `Dockerfile`, `compose*.yaml` |
| CI/CD | the GitHub Actions pipeline | `.github/workflows/` |
| AWS | the AWS deployment | `infra/aws/` |
| Java OOP | the domain model in plain Java | `java/` |
| Spring Boot | the Java edition of the API | `spring/` |
| System Design | Taskboard at 10 million daily users | `docs/design/` |

Code exercises use a real code editor (CodeMirror 5, vendored in `site/vendor/`) with syntax highlighting, line numbers, bracket matching and auto-indent; Esc releases keyboard focus. Lessons and exercises run in the browser; accounts are stored on the server. Signed-in progress and drafts are saved to the account and available across devices. When an account first saves progress, existing progress and drafts from that browser are copied to it. Signed-out activity stays in that browser.

Exercise engines:

- SQL runs on SQLite (sql.js).
- Bash runs on `minibash`, a bash simulator in `site/engine/`.
- Docker, Compose, Maven and the JVM run in a simulated engine (`site/engine/docker.js`).
- FastAPI, Spring Boot, Java, GitHub Actions, AWS and system-design exercises are checked against requirement lists (`site/engine/grade.js`), or ask you to predict an output.

## Run it locally

```bash
pip install -r requirements.txt
# Start MySQL and create a database and user (see environment variables below).
uvicorn server:app --host 127.0.0.1 --port 8765
```

Then open http://localhost:8765. Opening `index.html` directly from disk won't work, because browsers block local scripts. The SQL engine is loaded from cdnjs, so you need to be online.

## Run it in Docker

```bash
docker compose up -d --build     # serves the site on 127.0.0.1:8091
```

Accounts are stored in MySQL. For local development, configure `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` (defaults: `127.0.0.1`, `3306`, `prac`, `prac`, `prac`). Docker Compose starts MySQL and stores its data in the `prac-data` volume. Set `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` before first starting Compose; keep those credentials consistent with the existing database volume. For a deployment served over HTTPS, set `PRAC_SECURE_COOKIE=1` to mark session cookies secure.

## Edit the content

- Lessons and exercises: `src/<track>/*.md` (front matter, markdown, then `:::exercise` / `:::quiz` blocks). Callouts: `> [!tip]`, `[!warn]`, `[!note]`, `[!plain]` (in plain English), `[!mistake]`, `[!project]`. Exercise ids starting with `proj-` are Taskboard steps: they get the Project badge, are listed last, and take a `path:` field naming the file they write in the learner's Taskboard repo. Never rename an exercise `id`: saved progress is keyed by it.
- Every exercise should be answerable from its lesson and the lessons before it (or a prerequisite named in the track's first lesson). Teach a command, flag, keyword or format in the lesson before an exercise asks for it.
- Practice database: `tools/gen_db.py` writes `src/db.sql`
- Practice home folders: `src/fs/home/student/` (Bash) and `src/fs-docker/home/student/` (Docker, Spring; includes `taskboard/`). Empty directories hold a `.keep` file so git keeps them; the build skips it.
- Cheat sheets: `src/cheatsheet-<track>.md`

Rebuild with `node tools/build.js` (or, without Node installed, `docker run --rm -v "$PWD":/w -w /w node:20-alpine node tools/build.js`). It regenerates `site/content.js` and validates everything: it runs every shell and SQL solution and runnable example against the real engines, and checks that every requirement-list solution passes its rules while its starter code doesn't. `node tools/shelltest.js` runs the shell simulator's regression tests.
