---
id: bash-grep
title: grep & regular expressions
summary: Searching text with grep and its essential flags, then regular expressions — anchors, classes, quantifiers, groups, alternation — in basic and extended syntax.
minutes: 40
---
> [!project] logwatch, step 7: finding the failures
> Status codes tell you what went wrong: 4xx means the client asked for something bad, 5xx means the server broke. Regular expressions let logwatch find exactly those lines and nothing else.

## grep prints matching lines

`grep PATTERN [FILE...]` prints every line containing a match for PATTERN.

```bash run
grep ERROR logs/app.log
```

### The flags you'll use constantly

| Flag | Effect |
|---|---|
| `-i` | ignore case |
| `-v` | invert: lines that do **not** match |
| `-c` | count matching lines (per file) |
| `-n` | prefix line numbers |
| `-l` | list only the names of files that match |
| `-o` | print only the matched part, one per line |
| `-w` | match whole words only |
| `-x` | match whole lines only |
| `-E` | extended regex (`+ ? | ( ) { }` work unescaped) |
| `-F` | fixed string: no regex at all |
| `-r` | search directories recursively |
| `-A n` / `-B n` / `-C n` | show n lines after / before / around each match |
| `-q` | quiet: no output, just the exit status |

```bash run
grep -c ERROR logs/app.log
grep -in todo notes.txt
grep -v '^#' data/config.ini | grep -v '^$'
```

```bash run
grep -rl TODO projects
```

```bash run
grep -B1 -A1 'ERROR: destination full' logs/cron.log
```

> [!tip] Quote your patterns
> Always put the pattern in single quotes. Otherwise bash may expand `*` or `$` before grep ever sees them.

## Regular expressions

A **regular expression** (regex) is a pattern language. grep's default dialect is **BRE** (basic); `grep -E` uses **ERE** (extended), which is what most people mean by "regex".

### Literal characters and the dot

Most characters match themselves. `.` matches **any single character**. To match a literal dot, escape it: `\.`.

```bash run
grep 'w.b' data/servers.txt
grep '10\.0\.2\.' data/servers.txt
```

### Anchors

| Anchor | Matches at |
|---|---|
| `^` | start of line |
| `$` | end of line |
| `\b` | word boundary (GNU) |
| `\<`, `\>` | start / end of a word (GNU) |

```bash run
grep '^\[high\]' todo.txt
grep 'down$' data/servers.txt
```

### Character classes

| Class | Matches |
|---|---|
| `[abc]` | a, b or c |
| `[a-z]` | a lowercase letter |
| `[^0-9]` | anything but a digit |
| `[[:digit:]]` | a digit (POSIX class; also `[:alpha:]`, `[:space:]`, `[:upper:]`, `[:alnum:]`) |

### Quantifiers

| ERE | BRE | Meaning |
|---|---|---|
| `*` | `*` | 0 or more of the previous item |
| `+` | `\+` | 1 or more |
| `?` | `\?` | 0 or 1 |
| `{3}` | `\{3\}` | exactly 3 |
| `{2,4}` | `\{2,4\}` | 2 to 4 |
| `{2,}` | `\{2,\}` | 2 or more |

```bash run
grep -E '[0-9]{3}-[0-9]{4}' data/contacts.txt
```

### Groups and alternation

| ERE | Meaning |
|---|---|
| `(abc)` | group: quantifiers apply to the whole group |
| `a|b` | either a or b |

```bash run
grep -E 'WARN|ERROR' logs/app.log | head -4
grep -E '^(web|db)-' data/servers.txt
```

> [!exam] BRE vs ERE in one line
> In BRE (plain grep, sed), `+ ? | ( ) { }` are **literal** unless backslashed. In ERE (`grep -E`, `sed -E`, awk) they're operators, and backslashing makes them literal. When in doubt, use `-E`.

### Extracting with -o

`-o` prints just the matching text: perfect for pulling structured values out of messy lines.

```bash run
grep -oE '[A-Za-z0-9._]+@[A-Za-z0-9.]+\.[a-z]{2,}' data/contacts.txt
```

```bash run
grep -oE '"(GET|POST|DELETE) [^ ]+' logs/access.log | sort | uniq -c | sort -rn | head -5
```

### Greedy matching

`*` and `+` are **greedy**: they match as much as possible. `grep -o '<.*>'` on `<b>hi</b>` matches the whole thing, not just `<b>`. A negated class stops early: `<[^>]*>`.

## grep in scripts: exit status

grep exits **0** if any line matched, **1** if none matched, **2** on errors. Combined with `-q`, that makes it a condition:

```bash run
if grep -q 'db-02.*maintenance' data/servers.txt; then
  echo "db-02 is in maintenance"
fi
```

## Worked example: a regex that doesn't over-match

Goal: lines in `access.log` with a **4xx or 5xx status**. A naive attempt:

```bash run
grep -c '404' logs/access.log
```

That counts any line containing `404` anywhere, including a byte count like `14040`. Be precise about **where** the match is. The status is the 3-digit field after the closing quote of the request:

```bash run
grep -cE '" [45][0-9]{2} ' logs/access.log
```

Read the pattern piece by piece:

| Piece | Matches |
|---|---|
| `"` | the closing quote of the request |
| ` ` | a space |
| `[45]` | the digit 4 or 5 |
| `[0-9]{2}` | exactly two more digits |
| ` ` | a space (so `4040` can't match) |

Anchoring a pattern to its surroundings (quotes, spaces, `^` line start, `$` line end, `\b` word boundary) is the difference between a regex that's right and one that's right *today*.

> [!plain] In plain English
> A regular expression is a tiny pattern language. `.` is any character, `*` "zero or more of the previous", `[abc]` "one of these", `^`/`$` start/end of line. `-E` turns on the modern syntax where `+ ? { } |` work without backslashes.

## grep options you'll use daily

| Option | Does |
|---|---|
| `-i` | ignore case |
| `-v` | invert: lines that **don't** match |
| `-c` | count matching lines |
| `-n` | show line numbers |
| `-o` | print only the matched part |
| `-r` | search a directory recursively |
| `-l` | list only file names that match |
| `-w` | match whole words only |
| `-A 2` / `-B 2` / `-C 2` | context lines after / before / around |

## Common mistakes

> [!mistake] Forgetting to quote the pattern
> `grep [45]0 file` lets the shell try to glob `[45]0` against file names first. Always single-quote regexes.

:::quiz
q: Which command prints lines that do NOT contain "debug", ignoring case?
- `grep -n debug file`
+ `grep -vi debug file`
- `grep -c debug file`
- `grep -o -i debug file`
why: -v inverts the match; -i ignores case.
:::

:::quiz
q: In a regex, what does `^a.*z$` match?
- lines containing "a" and "z"
+ lines that start with "a" and end with "z"
- the literal text a.*z
- lines with only the letters a and z
why: ^ and $ anchor to the line's start and end; .* matches anything in between.
:::

:::quiz
q: Which matches one or more digits in plain (BRE) grep?
- `grep '[0-9]+'`
+ `grep '[0-9]\+'`
- `grep '[0-9]*'`
- `grep '\d+'`
why: In BRE, + is literal unless escaped. ([0-9]* also matches zero digits, i.e. every line.)
:::

:::quiz
q: What does `grep -c ERROR a.log b.log` print?
- the total number of ERROR lines
+ one count per file, like `a.log:3`
- the matching lines with counts
- only files with errors
why: With multiple files, -c prints a count for each, prefixed by the filename.
:::

:::quiz
q: To match a literal period in a regex, write…
- `.`
+ `\.`
- `[.]` is invalid
- `..`
why: An unescaped dot matches any character. `\.` (or `[.]`) matches only a period.
:::

:::exercise
id: gr-error
level: 1
title: Find the errors
---
Print every line of `logs/app.log` containing `ERROR`.
---solution
grep ERROR logs/app.log
:::

:::exercise
id: gr-count
level: 1
title: How many warnings?
---
Print the number of lines in `logs/app.log` containing `WARN`.
---solution
grep -c WARN logs/app.log
:::

:::exercise
id: gr-case
level: 1
title: Any case
---
Print lines of `data/contacts.txt` containing `example.com` regardless of upper/lower case.
---solution
grep -i 'example.com' data/contacts.txt
:::

:::exercise
id: gr-invert
level: 2
title: Servers that are not up
---
Print the lines of `data/servers.txt` for servers whose status is **not** `up`.
---hint
Match ` up$` and invert.
---solution
grep -v ' up$' data/servers.txt
:::

:::exercise
id: gr-numbered
level: 2
title: Where are the TODOs?
---
Print the lines of `notes.txt` that start with `TODO`, with their line numbers.
---solution
grep -n '^TODO' notes.txt
:::

:::exercise
id: gr-recursive
level: 2
title: TODOs anywhere
---
List the **names** of all files under `projects/` that contain `TODO` (one per line, as `grep` prints them).
---solution
grep -rl TODO projects
:::

:::exercise
id: gr-config
level: 2
title: Real config lines
---
Print the lines of `data/config.ini` that are **not** comments (starting with `#`) and **not** blank.
---hint
Either chain two `grep -v`, or use `grep -Ev '^(#|$)'`.
---solution
grep -Ev '^(#|$)' data/config.ini
:::

:::exercise
id: gr-word
level: 2
title: Whole word only
---
Print lines of `notes.txt` containing the lowercase **word** `the` on its own (so `there` or `other` wouldn't count, and neither does capitalized `The`).
---solution
grep -w 'the' notes.txt
:::

:::exercise
id: gr-ips
level: 3
title: Extract every IP
---
From `data/servers.txt`, print only the IP addresses (one per line) using `grep -o` and a regex.
---hint
Four groups of digits separated by literal dots: `[0-9]+\.` three times, then `[0-9]+`.
---solution
grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' data/servers.txt
:::

:::exercise
id: gr-emails
level: 3
title: Valid-looking emails
---
Print only the email addresses in `data/contacts.txt` that look valid: something, `@`, a domain name containing at least one dot. Print the matched emails only (not whole lines). Matching should be case-insensitive.
---hint
`grep -oiE '[a-z0-9._]+@[a-z0-9-]+\.[a-z.]+'`
---solution
grep -oiE '[a-z0-9._]+@[a-z0-9-]+\.[a-z.]+' data/contacts.txt
:::

:::exercise
id: gr-phones
level: 3
title: Standard phone format
---
Print the lines of `data/contacts.txt` whose phone number is written exactly as `NNN-NNN-NNNN` (digits and dashes, like `919-555-0199`).
---solution
grep -E '[0-9]{3}-[0-9]{3}-[0-9]{4}' data/contacts.txt
:::

:::exercise
id: gr-context
level: 3
title: Errors with context
---
Print each `ERROR` line in `logs/cron.log` together with the **one line before** it.
---solution
grep -B1 ERROR logs/cron.log
:::

:::exercise
id: gr-404-paths
level: 4
title: Broken links report
---
From `logs/access.log`, list the distinct request **paths** that returned status `404`, each once, sorted. (A line looks like `... "GET /favicon.ico HTTP/1.1" 404 1234`.)
---hint
Filter lines with `" 404 `, then extract the path with `grep -oE '"[A-Z]+ [^ ]+'` and `cut -d' ' -f2`.
---solution
grep '" 404 ' logs/access.log | grep -oE '"[A-Z]+ [^ ]+' | cut -d' ' -f2 | sort -u
:::

:::exercise
id: gr-error-components
level: 4
title: Which components fail most?
---
For lines of `logs/app.log` at level `ERROR`, count errors per component (the name in square brackets, e.g. `[db]`). Print as `uniq -c` does, most errors first, ties alphabetical.
---solution
grep ' ERROR ' logs/app.log | grep -oE '\[[a-z]+\]' | sort | uniq -c | sort -k1,1nr -k2,2
:::

:::exercise
id: gr-login-users
level: 4
title: Who logged in?
---
From `logs/app.log`, print each distinct username from `user login ok user=NAME` lines, with how many times they logged in, as `uniq -c` would print it, sorted by name.
---solution
grep -o 'user=[a-z]*' logs/app.log | cut -d= -f2 | sort | uniq -c
:::

:::exercise
id: proj-bash-07-failures
level: 2
title: "Project 7: count failed requests"
---
Count the requests in `logs/access.log` whose status code is 4xx or 5xx, using one `grep` with an extended regex anchored to the status field.
---solution
grep -cE '" [45][0-9]{2} ' logs/access.log
:::

:::exercise
id: proj-bash-07-errors-context
level: 3
title: "Project 7b: errors by component"
---
Print, sorted and de-duplicated, the **component names** (the word inside square brackets, e.g. `api`) of every `ERROR` line in `logs/app.log`, without the brackets.
---hint
`grep ERROR`, then `grep -o '\[[a-z]*\]'`, then strip brackets with `tr -d '[]'`.
---solution
grep ERROR logs/app.log | grep -o '\[[a-z]*\]' | tr -d '[]' | sort -u
:::
