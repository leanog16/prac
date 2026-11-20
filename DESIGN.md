---
name: prac
description: Learn SQL, Bash, Docker, FastAPI and Spring by doing; a Swiss grid where every exercise is one pixel.
colors:
  ground: "#eceff2"
  surface: "#ffffff"
  surface-2: "#e2e6ea"
  ink: "#0f1216"
  muted: "#545d68"
  line: "#d3d8de"
  line-strong: "#b5bcc5"
  band: "#0f1216"
  band-ink: "#f1f3f5"
  band-muted: "#a3acb6"
  band-line: "#262b31"
  code-bg: "#f5f7f9"
  term-bg: "#0f1216"
  term-ink: "#dfe5ea"
  term-dim: "#8592a0"
  term-err: "#ff8a80"
  term-prompt: "#7fd6a8"
  sql: "#0b7a6f"
  bash: "#c2410c"
  docker: "#1d5fd0"
  fastapi: "#8b3fb0"
  spring: "#3f7a1f"
  sql-soft: "#dcefec"
  bash-soft: "#f9e4d9"
  docker-soft: "#dfe8f9"
  fastapi-soft: "#f0e4f6"
  spring-soft: "#e3efda"
  on-trk: "#ffffff"
  ok: "#1a7a45"
  ok-soft: "#dcf0e3"
  bad: "#b3261e"
  bad-soft: "#f8e0dd"
  warn: "#8a5a00"
  warn-soft: "#f6ecd6"
  syntax-keyword: "#8a2fa8"
  syntax-string: "#1f7a3a"
  syntax-number: "#a35200"
  syntax-comment: "#6b7783"
  syntax-function: "#0e5fb0"
  syntax-variable: "#a33a1f"
  syntax-operator: "#4f5b67"
typography:
  display:
    fontFamily: "Pixelify Sans, Geist, system-ui, sans-serif"
    fontSize: "clamp(44px, 6.4vw, 84px)"
    fontWeight: 500
    lineHeight: 0.92
    letterSpacing: "0"
  headline:
    fontFamily: "Pixelify Sans, Geist, system-ui, sans-serif"
    fontSize: "clamp(34px, 5vw, 54px)"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0"
  title-pixel:
    fontFamily: "Pixelify Sans, Geist, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.1
  title:
    fontFamily: "Geist, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
  numeral:
    fontFamily: "Pixelify Sans, Geist, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: "0px"
spacing:
  hairline: "1px"
  pixel-gap: "3px"
  pixel-cell: "10px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  section: "56px"
components:
  button-primary:
    backgroundColor: "{colors.sql}"
    textColor: "{colors.on-trk}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
  button-quiet:
    textColor: "{colors.muted}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
  button-quiet-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  button-small:
    rounded: "{rounded.none}"
    padding: "4px 10px"
  pixel-open:
    rounded: "{rounded.none}"
    size: "10px"
  pixel-lit:
    backgroundColor: "{colors.sql}"
    rounded: "{rounded.none}"
    size: "10px"
  stepper-cell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.none}"
    height: "34px"
    width: "34px"
  stepper-cell-solved:
    backgroundColor: "{colors.sql}"
    textColor: "{colors.on-trk}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "24px 26px 26px"
  band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.band-ink}"
    height: "56px"
  input-editor:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
---

# Design System: prac.

## Overview

**Creative North Star: "The Progress Map"**

Swiss Design grid discipline fused with Pixel Art. The progress you have made is the map: every exercise is one square pixel, a module is a row of pixels, a track is a grid of rows. The pixels are not ornament; they are the record of what you solved, and they double as the navigation to what you have not. Around them sits a strict, flush-left Swiss page: square corners, 1px hairlines, large jumps between a pixel display face and a quiet grotesque.

The world is cool and nearly colourless at rest. An ink-black band sits over a light-grey ground (near-black in dark mode), panels are white sheets on that ground, and the only saturated colour is the current track's hue, which is spent exclusively on things you can act on and on pixels you have lit. Density is that of a working tool: comfortable reading measure for lessons, compact tabular rows for indexes, one exercise on screen at a time.

Motion is stepped. Solving an exercise fills its pixel bottom-to-top in four discrete frames; drawers and button states also move in steps, never on smooth curves.

**Key Characteristics:**
- One pixel per exercise; boss exercises are double-width cells, so size carries hierarchy.
- Nine track hues (SQL teal, Bash orange, Docker blue, FastAPI violet, Spring green, CI/CD magenta #a3336b, AWS amber #8a6400, Java crimson #b3263e, System Design indigo #3d55b8; dark: #f08fbf, #e8c15a, #ff7583, #9aabf7), one per surface, scoped by a track class. The brand mark is a 3x3 grid, one cell per track.
- Square corners everywhere; hairline borders; no drop shadows.
- Pixelify Sans for display and big numerals, Geist for UI and reading, Geist Mono for code and indices.
- All motion uses `steps()` timing; reduced-motion removes it entirely.
- Full light and dark themes from the same token names (system preference, overridable by `data-theme`).

## Colors

A cool grey-and-ink neutral field with one saturated track hue per surface, held back for action and achievement.

### Primary
- **Track Hue** (`sql` / `bash` / `docker` / `fastapi` / `spring`): the current track's colour, resolved into a single "track" variable by the surface's track scope. Used for primary button fills, lit pixels and solved stepper cells, the active step tab bar and the active band tab bar, link underlines, focus outlines, text-selection, and the editor caret. Dark mode swaps in brighter, lighter versions of each hue so fills still read on near-black.
- **On-Track** (`on-trk`): text on a track-hue fill. White in light mode, near-black in dark mode, because the dark-mode hues are light.
- **Track Wash** (`*-soft`): the pale tint of each hue. Used for the pager's hover fill.

### Neutral
- **Cool Ground** (`ground`): the page background; also the background of the sticky step bar so it masks content scrolling under it.
- **Sheet White** (`surface`): panels, exercise cards, quiz questions, rail, tables, default buttons.
- **Pressed Grey** (`surface-2`): hover and current-item fill in the rail, table headers, inline code, neutral feedback, unlit segments of progress bars.
- **Ink** (`ink`): body text, the 1px rule that opens a section, the outline of the Continue panel, hover borders on controls, the current-stepper outline.
- **Slate** (`muted`): secondary text, metadata, labels, unselected tabs.
- **Hairline** (`line`) and **Strong Hairline** (`line-strong`): borders and dividers; the strong one outlines empty pixels, buttons, inputs and quiz options.
- **Band Black** (`band`, `band-ink`, `band-muted`, `band-line`): the top band, its text, its inactive tabs and its internal dividers.
- **Code and Terminal** (`code-bg`, `term-bg`, `term-ink`, `term-dim`, `term-err`, `term-prompt`): editor and code-block paper; the terminal is always dark in both themes.

### Status
- **Pass Green** (`ok`, `ok-soft`), **Fault Red** (`bad`, `bad-soft`), **Hint Amber** (`warn`, `warn-soft`): feedback boxes, checklists, quiz right/wrong, hint panels, tip and warning callouts. Status colours are always paired as a soft fill with strong text, never as a solid block.

### Syntax
- **Syntax set** (`syntax-*`): keyword violet, string green, number amber, comment grey italic, function blue, variable rust, operator slate. Used only inside code.

### Named Rules
**The Lit Pixel Rule.** Track hue appears only on what you can act on (primary buttons, focus, link underlines, the active tab bar) and on pixels you have lit. Headings, panels, borders and body text stay ink and grey. If something is coloured and you cannot click it or did not earn it, it is wrong.

**The One Track Rule.** A surface takes its hue from the track scope it sits in. One panel, one hue; the home grid gives each track panel its own scope rather than mixing hues inside a panel.

## Typography

**Display Font:** Pixelify Sans (with Geist, system-ui)
**Body Font:** Geist (with Helvetica Neue, Arial)
**Label/Mono Font:** Geist Mono (with ui-monospace, SF Mono, Menlo)

**Character:** A blocky pixel face at large sizes against a neutral Swiss grotesque for everything you read or press. The jump in size and texture between them does the hierarchy work, so neither needs decoration.

### Hierarchy
- **Display** (700, clamp 44px to 84px, line-height 0.92): the home intro headline only, set across seven of twelve columns.
- **Headline** (700, clamp 34px to 54px, line-height 1): page titles for modules and tool pages; 36px on phones.
- **Title, pixel** (700, 28px to 40px, line-height 1 to 1.1): section headings, lesson h2s, track panel names (40px), rail track title (34px).
- **Title** (Geist 700, 20px to 30px, slight negative tracking): exercise titles (20px) and the Continue heading (clamp 22px to 30px). These are reading headings, not display, so they stay in Geist.
- **Body** (Geist 400, 16px, line-height 1.6): lessons at 16.5px with a 70ch measure; ledes at 17px to 18px in Slate with a 62ch measure.
- **Label** (Geist 600, 12.5px to 14.5px, sentence case): buttons (14.5px), level tags, rail group labels, table headers, step tabs (15px).
- **Numeral** (Pixelify 500, 18px to 40px, tabular): solved counts, rail stats, review scores.
- **Mono** (Geist Mono, 12px to 14px): code, editors, terminal, and every index number (module numbers, exercise numbers, quiz numbers, stepper digits, code labels).

### Named Rules
**The Pixel Voice Rule.** Pixelify Sans is for display headings and big numerals only. Body, buttons, labels and form controls are Geist; never set running text or a control in the pixel face.

**The Mono Index Rule.** Ordinals and indices are Geist Mono with tabular figures, so columns of numbers line up like a register.

## Layout

A flush-left Swiss page under a 56px sticky band. Track pages use a two-column shell: a 300px sticky rail (module list with mini pixel strips, then practice and reference links) and a work column centred at 860px (960px for modules, 1200px for wide tools and home). Home uses a 12-column intro grid (headline spans 7, lede spans 5, bottom-aligned), then a full-width Continue panel, then a two-column grid of track panels.

Spacing steps through 4, 8, 16, 24, 40 and 56px; sections open 56px down with a 1px ink rule and 16px of air. Pixel geometry is its own scale: a 10px cell with a 3px gap by default, 6px cells in the rail, 12px on home maps and the Continue strip, 14px in the module strip and practice index, 34px stepper cells (38px on phones).

Responsive: below 1100px the intro stacks; below 900px the rail becomes an off-canvas drawer opened from the band (hidden on home), and the track grid and playground go single-column; below 640px the wordmark and band swatches drop, step counts hide, and module maps wrap their strips under the title.

### Named Rules
**The Visible Armature Rule.** The grid is drawn, not implied: track panels and the pager sit in a 1px-gutter grid whose gutters show the hairline colour, sections open on a full-width ink rule, and the step bar is underlined in ink.

## Elevation & Depth

Flat. Depth comes from tone (Cool Ground under Sheet White panels), hairline borders, and one heavier ink outline on the Continue panel. The only box-shadow in the system is an inset 2px ink bar on the left edge of the current module in the rail, which is an indicator, not elevation. The keyboard-key style uses a 2px bottom border for its keycap. The sticky band and step bar separate from content by colour and a 1px line, not shadow. The mobile drawer sits over a 50% black scrim.

### Named Rules
**The Flat Plane Rule.** Nothing floats. No drop shadows, blurs or glows; hierarchy is carried by tone, line weight and size.

## Shapes

Every corner is square (0px radius), including inputs and selects that would otherwise inherit platform rounding. Borders are 1px; 2px is reserved for focus outlines and the stepper's current-cell outline; 4px for the active tab bar under band tabs and step tabs. Dashed 1px borders mark provisional or empty things (the revealed solution, empty-state boxes). Icons are drawn on an 8 by 8 pixel grid as SVG rectangles with crisp edges (check, cross, arrows, play, menu), sized at 1em and filled with the current text colour. Difficulty is shown as four 6px square pips, filled to the level.

### Named Rules
**The Square Corner Rule.** Radius is zero, everywhere. The pixel is the only shape.

**The Double Square Rule.** A boss exercise occupies two cells plus the gap. Importance is expressed by size, never by a different colour.

## Components

### Buttons
Tactile, square and plain; the primary is the only coloured thing in most views.
- **Shape:** square (0px), 1px border, 8px by 16px padding, Geist 600 at 14.5px, icon gap 8px.
- **Primary:** track-hue fill and border with On-Track text. Hover mixes 14% ink into the hue.
- **Default:** Sheet White with a Strong Hairline border; hover turns the border Ink.
- **Quiet:** transparent, Slate text, 10px side padding; hover fills Pressed Grey and turns Ink. Used for secondary links like "All exercises" and "Review quiz".
- **Small:** 4px by 10px, 13px text; used in code-block action rows.
- **Hover / Focus:** background and border change in two steps over 120ms. Focus is a 2px track-hue outline offset 2px. Disabled drops to 45% opacity.

### Cards / Containers
- **Corner Style:** square (0px).
- **Background:** Sheet White on Cool Ground.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Hairline; the Continue panel alone uses a 1px Ink border.
- **Internal Padding:** 18px to 28px (exercise header 16px by 20px, quiz question 18px by 20px, track panel 24px by 26px, Continue panel 24px by 28px).
- **Callouts:** tip on Pass Green wash, warning on Hint Amber wash, exam on Sheet White with an ink hairline; note and why on Sheet White with a hairline.

### Inputs / Fields
- **Style:** square, 1px Strong Hairline border; editors and answer inputs on Code paper in Geist Mono 14px with 12px by 14px padding; selects and search on Sheet White.
- **Focus:** 2px track-hue outline drawn inset; the editor caret is track hue.
- **Quiz options:** full-width square rows with a mono letter key; hover borders Ink; answered rows become Pass Green or Fault Red wash with a matching border.

### Navigation
- **Band:** ink-black, 56px, sticky. Pixel brand mark plus the "prac." wordmark in Pixelify 24px, separated by a band hairline; then track tabs in Geist 600 14.5px, Band Muted until hovered or current, each with an 8px square swatch. The current tab carries a 4px bar in its own hue along the bottom edge.
- **Rail:** Sheet White, sticky, 300px. Track title in Pixelify 34px, a solved stat, then modules as a mono number plus title over a 6px pixel strip. Hover and current fill Pressed Grey; current also gets an ink number and 600 weight.
- **Step bar:** sticky under the band on Cool Ground, ink underline; tabs (Lesson, Quick check, Exercises) with a mono step number and a tabular count, current tab marked by a 4px track-hue bar.
- **Pager:** two hairline-gutter cells, previous and next, with small Slate labels over 17px bold titles; hover washes in Track Wash.
- **Mobile:** the rail becomes a drawer opened by a square 40px band button with a pixel menu icon, sliding in four steps.

### Pixel Strip (signature)
The progress map itself. Each exercise is a square cell with a 1px Strong Hairline outline; solved cells fill with the track hue. Boss cells are double width. Strips link to their module; hovering a strip darkens the outline of its open cells to Ink. When an exercise is solved, its cell lights from the bottom up in four steps over 360ms. A segmented 8px progress bar (Pressed Grey segments lit in track hue) is the compact variant.

### Exercise Stepper (signature)
A row of 34px square buttons, one per exercise in the module, numbered in Geist Mono. Open cells are white with a hairline; solved cells fill with track hue; the current cell has a 2px ink outline offset 2px; boss cells are double width. A small key under it (Solved, Open, Boss) uses real pixel cells as its swatches. Only one exercise card shows at a time beneath it.

### Exercise Card
A white sheet with a header row (mono number, 20px Geist title, level pips, a green "Solved" tag when done) over a body of prompt, editor, and an action row: Check (primary) and Run (default) on the left, the stuck-ladder of quiet buttons (hint, expected output, solution) on the right. Hints sit on Hint Amber wash; the revealed solution sits in a dashed box; feedback is a soft status block with an explanation under a hairline.

### Code Editor
CodeMirror 5 (vendored in `site/vendor/`) themed `prac`: Code paper, Geist Mono 14px, a hairline gutter with Slate line numbers, Pressed Grey active line, a 2px track-hue caret, track-hue selection wash and bracket outline, and the shared `--tk-*` syntax tokens. Square, 1px Strong Hairline border; focus is the 2px inset track-hue outline. It grows with its content (min height set per editor, max 560px). Esc releases keyboard focus to the Check/Run button, so Tab never traps. Falls back to the plain textarea if the script fails to load.

### Taskboard Project
One project spans every track. **Gate** (signed out, on a Project step): a Sheet White box with an Ink outline, a 18px Geist title, a Slate explanation and Sign in (primary) / Create an account. **Project line** (signed in): a Pressed Grey strip with a hairline naming the repo path, with "Open the project" at the far end. **Project page** (`#project`): page title, a Continue-style "Next" panel, **Your repo** (a 280px file tree beside a read-only editor, Download as .zip), then **The build**: one `<details>` row per track with its role, its step pixels and a count, opening to modules and their steps with paths. The home page carries a compact project panel under Continue.

## Do's and Don'ts

### Do:
- **Do** spend track hue only on primary buttons, lit pixels, solved stepper cells, active tab bars, focus outlines, link underlines and the caret (The Lit Pixel Rule).
- **Do** scope every track surface with its track class so one hue governs the whole panel or page.
- **Do** keep every corner at 0px and every structural border at 1px.
- **Do** express importance by size: boss exercises take a double cell, display type jumps straight from 84px to body.
- **Do** time every transition and animation with `steps()`: 4 steps over 360ms for lighting a pixel, 4 steps over 240ms for the drawer, 2 steps over 120ms for button states.
- **Do** draw icons on the 8 by 8 pixel grid as crisp-edged SVG rectangles in the current text colour.
- **Do** set indices and code in Geist Mono with tabular figures.
- **Do** define every colour for both themes through the shared token names.

### Don't:
- **Don't** colour headings, panel backgrounds, borders or decorative marks with a track hue.
- **Don't** add drop shadows, blurs, glows or rounded corners.
- **Don't** use smooth easing curves for motion.
- **Don't** set body copy, buttons, labels or inputs in Pixelify Sans.
- **Don't** mix two track hues inside one panel.
- **Don't** use emoji or font glyphs as icons.
