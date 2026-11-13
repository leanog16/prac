# prac

A SQL and Bash study site: lessons, quizzes and auto-graded exercises. Everything runs in the browser. SQL runs on SQLite (sql.js), and Bash runs on `minibash`, a bash simulator in `site/engine/`.

## Run it locally

```bash
python3 -m http.server 8765 --directory site
```

Then open http://localhost:8765. (Opening `index.html` directly from disk won't work, because browsers block local scripts. The SQL engine is loaded from cdnjs, so you need to be online.)

## Edit the content

- Lessons and exercises: `src/sql/*.md`, `src/bash/*.md` (front matter, markdown, then `:::exercise` / `:::quiz` blocks)
- Practice database: `tools/gen_db.py` writes `src/db.sql`
- Practice home folder for the bash exercises: `src/fs/home/student/`
- Cheat sheets: `src/cheatsheet-*.md`

Rebuild with `node tools/build.js`. It regenerates `site/content.js` and runs every exercise solution and runnable example against the real engines, reporting anything that errors, prints nothing, or sorts ambiguously. `node tools/shelltest.js` runs the shell simulator's regression tests.
