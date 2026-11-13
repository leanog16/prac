---
id: bash-scripts
title: Scripts, arguments & conditions
summary: Writing script files with a shebang, positional parameters ($1, $#, "$@"), exit codes, test / [ ] / [[ ]], if/elif/else, case, && and ||, and safety settings.
minutes: 40
---
## A script is a file of commands

```bash title=greet.sh
#!/bin/bash
# Usage: greet.sh NAME [GREETING]
name=${1:-stranger}
greeting=${2:-Hello}
echo "$greeting, $name!"
```

- Line 1, the **shebang** `#!/bin/bash`, tells the system which interpreter runs the file. (`#!/usr/bin/env bash` finds bash on the PATH; more portable.)
- `#` starts a comment.
- Run it with `bash greet.sh` (no permissions needed) or make it executable once with `chmod +x greet.sh` and run `./greet.sh`.

```bash run
bash scripts/greet.sh
bash scripts/greet.sh Ada
bash scripts/greet.sh Ada Howdy
```

> [!note] Script exercises on this site
> In exercises marked with a file name like `script.sh`, the editor *is* the file. The grader saves it and runs `bash script.sh ARGS` for each listed test, comparing output against the reference script.

## Positional parameters

| Variable | Meaning |
|---|---|
| `$0` | the script's name |
| `$1` … `$9`, `${10}` | arguments |
| `$#` | number of arguments |
| `"$@"` | all arguments, **each as a separate word** (use this) |
| `"$*"` | all arguments joined into **one** string |
| `shift` | drop `$1` and move the rest down |

```bash run
cat > args.sh <<'EOF'
echo "script: $0, count: $#"
echo "first: $1, second: $2"
for a in "$@"; do echo "  arg: [$a]"; done
EOF
bash args.sh "two words" three
```

> [!exam] "$@" vs $@ vs "$*"
> `"$@"` preserves each argument exactly, even with spaces. Unquoted `$@` re-splits them. `"$*"` mashes them into one string. When forwarding arguments, it's always `"$@"`.

## Exit status

Every command exits with a number: **0 = success**, anything else = failure. `$?` holds the last status. A script's status is that of its last command, or whatever you pass to `exit`.

```bash run
ls data > /dev/null; echo "ls ok: $?"
ls nope 2> /dev/null; echo "ls failed: $?"
grep -q zzz notes.txt; echo "no match: $?"
```

### && and ||

`a && b` runs b only if a succeeded; `a || b` runs b only if a failed.

```bash run
mkdir -p out && echo "created"
cd nowhere 2>/dev/null || echo "couldn't cd"
[ -f notes.txt ] && echo "notes exist" || echo "no notes"
```

## Tests: [ ] and [[ ]]

`[ expr ]` (also spelled `test expr`) is a command that exits 0 when `expr` is true. **The spaces inside the brackets are required**: `[` is literally a command name and `]` its last argument.

| Test | True when |
|---|---|
| `-e path` | exists |
| `-f path` | is a regular file |
| `-d path` | is a directory |
| `-s path` | exists and is non-empty |
| `-r` / `-w` / `-x path` | readable / writable / executable |
| `-z "$s"` | string is empty |
| `-n "$s"` | string is non-empty |
| `"$a" = "$b"`, `"$a" != "$b"` | strings equal / differ |
| `$a -eq $b` | integers equal (`-ne -lt -le -gt -ge`) |
| `! expr` | negation |

> [!warn] Strings vs numbers
> `=` compares **strings**; `-eq`, `-lt`… compare **integers**. `[ 10 > 9 ]` doesn't compare numbers at all: `>` inside `[ ]` is a *redirection* that creates a file named 9! Use `-gt`, or `(( 10 > 9 ))`.

`[[ … ]]` is bash's improved test: no word splitting inside (quoting optional), `&&`/`||` work inside, `==` does **glob** matching, and `=~` does **regex** matching.

```bash run
f="report.pdf"
[[ $f == *.pdf ]] && echo "a PDF"
[[ $f =~ ^([a-z]+)\.([a-z]+)$ ]] && echo "name=${BASH_REMATCH[1]} ext=${BASH_REMATCH[2]}"
n=42
(( n > 40 && n % 2 == 0 )) && echo "big and even"
```

## if / elif / else

`if` runs a command and branches on its exit status:

```bash run
score=83
if (( score >= 90 )); then
  echo "A"
elif (( score >= 80 )); then
  echo "B"
else
  echo "keep going"
fi
```

Any command works as the condition, not just tests:

```bash run
if grep -q '^db-02.*up$' data/servers.txt; then
  echo "db-02 is up"
else
  echo "db-02 is NOT up"
fi
```

## case

`case` matches a value against glob patterns: cleaner than a chain of `elif`s for string dispatch.

```bash run
for f in report.pdf photo.JPG song.mp3 notes.txt; do
  case "$f" in
    *.pdf|*.docx)   kind="document" ;;
    *.jpg|*.JPG)    kind="image" ;;
    *.mp3)          kind="audio" ;;
    *)              kind="other" ;;
  esac
  echo "$f: $kind"
done
```

Each branch ends with `;;`. `*)` is the catch-all.

## Defensive scripting

```bash
#!/bin/bash
set -euo pipefail
```

| Option | Effect |
|---|---|
| `-e` | exit immediately when a command fails |
| `-u` | treat unset variables as an error |
| `-o pipefail` | a pipeline fails if **any** stage fails, not just the last |

Also: validate arguments early and print usage to **stderr** with a non-zero exit:

```bash
if [ $# -lt 1 ]; then
  echo "usage: $0 FILE" >&2
  exit 1
fi
```

:::quiz
q: Inside a script run as `bash s.sh a "b c" d`, what is `$#`?
- 4
+ 3
- 2
- 1
why: Quoting keeps "b c" as a single argument: a, "b c", d.
:::

:::quiz
q: Why does `[$x -eq 5]` fail?
- -eq only works in [[ ]]
+ There must be spaces after `[` and before `]`
- 5 must be quoted
- $x must be in braces
why: `[` is a command; without the space bash looks for a command named `[5` or similar.
:::

:::quiz
q: Which tests whether a **directory** named `logs` exists?
- `[ -f logs ]`
+ `[ -d logs ]`
- `[ -z logs ]`
- `[ logs ]`
why: -d tests for a directory; -f for a regular file; -z for an empty string.
:::

:::quiz
q: What's the exit status convention?
+ 0 means success; non-zero means failure
- 1 means success; 0 means failure
- any positive number means success
- only 0 and 1 are allowed
why: Zero is success so that the many ways of failing can each have their own code.
:::

:::quiz
q: In `[[ $file == *.txt ]]`, the right side is…
- a regular expression
+ a glob pattern
- a literal string
- a filename that must exist
why: == in [[ ]] does glob matching (unquoted). Use =~ for regex.
:::

:::quiz
q: With `set -o pipefail`, `false | true` returns…
- 0
+ non-zero
- it depends on -e
- an error message
why: pipefail makes the pipeline's status the last non-zero status of any stage.
:::

:::exercise
id: sc-hello-arg
level: 1
title: Greet the first argument
mode: script
---
Write a script that prints `Hello, NAME!` where NAME is the first argument.
---test
args: Ada
---test
args: Grace
---solution
#!/bin/bash
echo "Hello, $1!"
:::

:::exercise
id: sc-count-args
level: 1
title: Count the arguments
mode: script
---
Write a script that prints `N arguments`, where N is how many arguments it received.
---test
args: a b c
---test
args:
---test
args: "one arg with spaces"
---solution
#!/bin/bash
echo "$# arguments"
:::

:::exercise
id: sc-default-arg
level: 2
title: Optional argument
mode: script
---
Write a script that prints `Report for DEPT` where DEPT is the first argument, or `all` if none is given.
---test
args: Sales
---test
args:
---solution
#!/bin/bash
echo "Report for ${1:-all}"
:::

:::exercise
id: sc-file-check
level: 2
title: What is it?
mode: script
---
Write a script that takes a path and prints one of: `PATH is a directory`, `PATH is a file`, or `PATH does not exist` (with the actual path in place of PATH).
---test
args: data
---test
args: notes.txt
---test
args: ghost.txt
---solution
#!/bin/bash
if [ -d "$1" ]; then
  echo "$1 is a directory"
elif [ -f "$1" ]; then
  echo "$1 is a file"
else
  echo "$1 does not exist"
fi
:::

:::exercise
id: sc-even-odd
level: 2
title: Even or odd
mode: script
---
Write a script that prints `N is even` or `N is odd` for its numeric first argument.
---test
args: 4
---test
args: 7
---test
args: 0
---solution
#!/bin/bash
if (( $1 % 2 == 0 )); then
  echo "$1 is even"
else
  echo "$1 is odd"
fi
:::

:::exercise
id: sc-usage
level: 2
title: Usage message
mode: script
status: true
stderr: true
---
Write a script that requires exactly **two** arguments. If it gets a different number, print `usage: script.sh SRC DEST` to **stderr** and exit with status `1`. Otherwise print `copying SRC to DEST` and exit 0.
---test
args: a.txt b.txt
---test
args: only-one
---test
args:
---solution
#!/bin/bash
if [ $# -ne 2 ]; then
  echo "usage: script.sh SRC DEST" >&2
  exit 1
fi
echo "copying $1 to $2"
:::

:::exercise
id: sc-grade
level: 3
title: Letter grade
mode: script
---
Write a script that takes a numeric score and prints its letter: `A` (90+), `B` (80–89), `C` (70–79), `D` (60–69) or `F`.
---test
args: 95
---test
args: 80
---test
args: 79
---test
args: 61
---test
args: 12
---solution
#!/bin/bash
s=$1
if (( s >= 90 )); then echo A
elif (( s >= 80 )); then echo B
elif (( s >= 70 )); then echo C
elif (( s >= 60 )); then echo D
else echo F
fi
:::

:::exercise
id: sc-case-ext
level: 3
title: File type by extension
mode: script
---
Write a script that prints the category of its argument by extension using `case`: `image` for `.jpg`, `.jpeg`, `.png` (any case is **not** required; lowercase only), `document` for `.pdf` or `.txt`, `code` for `.sh` or `.py`, and `unknown` otherwise.
---test
args: photo.png
---test
args: notes.txt
---test
args: run.sh
---test
args: archive.zip
---solution
#!/bin/bash
case "$1" in
  *.jpg|*.jpeg|*.png) echo image ;;
  *.pdf|*.txt)        echo document ;;
  *.sh|*.py)          echo code ;;
  *)                  echo unknown ;;
esac
:::

:::exercise
id: sc-server-status
level: 3
title: Is this server up?
mode: script
status: true
---
Write a script that takes a server name and checks `data/servers.txt`. Print `NAME is up` and exit 0 if its status is `up`; print `NAME is not up` and exit 1 if it exists but isn't up; print `NAME not found` and exit 2 if it's not listed.
---hint
`grep -q "^$1 "` tests existence; `grep -q "^$1 .* up$"` tests status.
---test
args: web-01
---test
args: db-02
---test
args: mail-01
---solution
#!/bin/bash
f=data/servers.txt
if ! grep -q "^$1 " "$f"; then
  echo "$1 not found"
  exit 2
elif grep -q "^$1 .* up$" "$f"; then
  echo "$1 is up"
else
  echo "$1 is not up"
  exit 1
fi
:::

:::exercise
id: sc-regex-validate
level: 3
title: Validate a course code
mode: script
---
Write a script that prints `valid` if its argument looks like a course code (2–3 uppercase letters, a space, three digits, e.g. `CSC 230`), else `invalid`. Use `[[ =~ ]]`.
---hint
Store the regex in a variable to avoid quoting headaches: `re='^[A-Z]{2,3} [0-9]{3}$'` then `[[ $1 =~ $re ]]`.
---test
args: "CSC 230"
---test
args: "MA 141"
---test
args: "csc 230"
---test
args: "CSC230"
---solution
#!/bin/bash
re='^[A-Z]{2,3} [0-9]{3}$'
if [[ $1 =~ $re ]]; then
  echo valid
else
  echo invalid
fi
:::

:::exercise
id: sc-max-of-three
level: 3
title: Largest of three
mode: script
---
Print the largest of three integer arguments.
---test
args: 3 9 4
---test
args: 10 2 7
---test
args: -1 -5 -3
---solution
#!/bin/bash
max=$1
(( $2 > max )) && max=$2
(( $3 > max )) && max=$3
echo "$max"
:::

:::exercise
id: sc-calc
level: 4
title: Tiny calculator
mode: script
status: true
stderr: true
---
Write a calculator: `script.sh A OP B` where OP is one of `+ - x /` (use `x` for multiply to avoid globbing). Print the integer result. For division by zero, print `error: division by zero` to stderr and exit 2; for an unknown operator, print `error: unknown operator OP` to stderr and exit 1.
---test
args: 7 + 5
---test
args: 7 x 6
---test
args: 7 / 2
---test
args: 1 / 0
---test
args: 2 % 3
---solution
#!/bin/bash
a=$1; op=$2; b=$3
case "$op" in
  +) echo $((a + b)) ;;
  -) echo $((a - b)) ;;
  x) echo $((a * b)) ;;
  /)
    if (( b == 0 )); then
      echo "error: division by zero" >&2
      exit 2
    fi
    echo $((a / b)) ;;
  *)
    echo "error: unknown operator $op" >&2
    exit 1 ;;
esac
:::

:::exercise
id: sc-leap
level: 4
title: Leap year
mode: script
---
Print `leap` or `common` for a year argument. A year is a leap year if divisible by 4, except century years, which must be divisible by 400.
---test
args: 2024
---test
args: 1900
---test
args: 2000
---test
args: 2026
---solution
#!/bin/bash
y=$1
if (( (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 )); then
  echo leap
else
  echo common
fi
:::
