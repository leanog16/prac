# prac

A study site with lessons, quizzes and auto-graded exercises for seven tracks: **SQL, Bash, Docker, FastAPI, Spring Boot, CI/CD and AWS**. Everything runs in the browser:

- SQL runs on SQLite (sql.js).
- Bash runs on `minibash`, a bash simulator in `site/engine/`.
- Docker, Compose, Maven and the JVM run in a simulated engine (`site/engine/docker.js`).
- FastAPI, Spring Boot, GitHub Actions and AWS exercises are checked against requirement lists (`site/engine/grade.js`), or ask you to predict an output.

## Run it locally

```bash
python3 -m http.server 8765 --directory site
```

Then open http://localhost:8765. Opening `index.html` directly from disk won't work, because browsers block local scripts. The SQL engine is loaded from cdnjs, so you need to be online.

## Run it in Docker

```bash
docker compose up -d --build     # serves the site on 127.0.0.1:8091
```

## Edit the content

- Lessons and exercises: `src/<track>/*.md` (front matter, markdown, then `:::exercise` / `:::quiz` blocks)
- Practice database: `tools/gen_db.py` writes `src/db.sql`
- Practice home folders: `src/fs/home/student/` (Bash) and `src/fs-docker/home/student/` (Docker, Spring). Empty directories hold a `.keep` file so git keeps them; the build skips it.
- Cheat sheets: `src/cheatsheet-<track>.md`

Rebuild with `node tools/build.js` (or, without Node installed, `docker run --rm -v "$PWD":/w -w /w node:20-alpine node tools/build.js`). It regenerates `site/content.js` and validates everything: it runs every shell and SQL solution and runnable example against the real engines, and checks that every requirement-list solution passes its rules while its starter code doesn't. `node tools/shelltest.js` runs the shell simulator's regression tests.
