# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/vanilla JS in `site/`, no build step for the page itself. Content is compiled into `site/content.js` by `node tools/build.js`. SQL runs on sql.js (loaded from cdnjs); Bash, Docker and Maven run in in-browser simulators under `site/engine/`.

## Users and job

Anyone learning SQL, Bash, Docker, FastAPI, Spring Boot, CI/CD, AWS, Java OOP or system design who wants to learn by doing. They read a short lesson, check their understanding with a quiz, then work graded exercises from warm-up to boss level. They return across many sessions and need to know where they left off and what to do next.

## What it makes possible

Lessons, quizzes and auto-graded exercises that run entirely in the browser: real SQLite queries, a bash simulator over a practice home folder, a simulated Docker engine, and requirement-checked FastAPI, Spring, Java, CI/CD workflow, AWS and system-design answers. Grading explains specifically what is off (wrong row count, wrong order, first differing line) rather than just pass/fail.

## Capabilities that must be preserved

- Nine tracks (SQL, Bash, Docker, FastAPI, Spring Boot, CI/CD, AWS, Java OOP, System Design), each building one project step by step, with numbered modules (lesson, quick-check quiz, exercises).
- Per-track pages: practice index with filters and "random unsolved", review quiz rounds, cheat sheet; SQL adds playground and schema; Bash/Docker add terminal and practice files; Spring adds a Maven terminal.
- Exercises: run, check, progressive hints, expected output, solution reveal with confirmation, reset, drafts saved, keyboard shortcuts (Cmd/Ctrl+Enter run, +Shift check).
- Progress, quiz answers, drafts and terminal history persist in localStorage under the `pj:` keys.
- Difficulty levels: Warm-up, Practice, Challenge, Boss.

## Known problems (from the owner)

Too many competing navigations, very long module pages, a home page that doesn't say where to go next, and exercise cards whose many buttons all look alike.

## Constraints

Keep every feature and the saved-progress keys. URLs and visual design may change.
