---
version: 1
slug: "site-index-html"
primary_target: "site/index.html"
related_targets: ["site/app.js"]
---

# prac app shell (all routes)

Mode: operate. Code-led. Covers home, track/module pages, exercises, practice, review, playground, schema, terminal, files, cheat sheet.

Audience: anyone learning SQL/Bash/Docker/FastAPI/Spring by doing, returning across sessions. Owner complaints: too many navs, endless module pages, home that doesn't say where to go, exercise buttons that all look alike. Keep every feature and the `pj:` storage keys; URLs may change.

## Direction contract

THESIS: Progress is the map. Every exercise is one pixel; a module is a row of pixels, a track is a pixel grid, so "where am I and what's next" is visible at a glance. Refuses the category default of a three-level nav (track pills + tabs + rail) over one endless page.

OWN-WORLD: Swiss Design grid discipline fused with Pixel Art. Square corners, 1px hairlines, flush-left, large type jumps. Pixelify Sans for display and numerals, Geist for UI/body, Geist Mono for code. Ink-black top band; cool light-grey ground (dark mode: near-black). The five track hues appear only on actionable things: primary buttons and lit pixels. Boss exercises are double-width cells (size carries hierarchy).

STORY: The visitor sees where they left off, continues in one click, and moves Lesson → Check → Exercises with one exercise on screen at a time, always knowing which pixel they're on.

FIRST VIEWPORT: Home: ink band with wordmark + track tabs; a "Continue" panel (track, module, next exercise, primary button); below it one panel per track on a 12-column grid, each showing its pixel map. Module: rail of modules with mini pixel bars at left; title, a 3-step tab bar (Lesson / Quick check / Exercises) and the module's pixel row at the top of the work column.

FORM: Pixel Art + Swiss Design (user-pinned menu; my list position 6 is Pixel Art, fused with Swiss Design at position 1). Raises: one saturated action colour reserved for actionable elements (from warm-consumer-app); mark size carries hierarchy (from star-atlas); the grid stays visible as an armature (from crouwel-grid-specimen). seed:173fed1c821cf59e

Signature move: solving lights the exercise's pixel with a steps() fill; all motion uses stepped timing.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
