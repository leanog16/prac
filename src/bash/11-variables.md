---
id: bash-vars
title: Variables & expansion
summary: Assigning and using variables, environment vs shell variables, command substitution, integer arithmetic, and parameter expansion tricks (defaults, trimming, replacing, substrings, case).
minutes: 35
---
## Assignment: no spaces

```bash run
name="Ada"
count=3
echo "$name has $count cats"
```

**No spaces around `=`.** `name = "Ada"` runs a *command* called `name` with arguments `=` and `Ada`. This is the most common beginner error in bash.

```bash run
name = "Ada" 2>&1   # fails on purpose
```

Variable names are letters, digits and underscores, not starting with a digit. By convention, lowercase for script-local variables, UPPERCASE for environment variables.

## Using variables: $name and ${name}

`$name` and `${name}` are the same, but braces are required when the name is followed by characters that could be part of a name:

```bash run
fruit="apple"
echo "I have 3 $fruits"      # looks for a variable named fruits (empty)
echo "I have 3 ${fruit}s"
```

Unset variables silently expand to nothing. `set -u` makes that an error, which catches typos.

## Environment variables

Shell variables are visible only in the current shell. `export` makes a variable part of the **environment**, inherited by child processes (scripts and programs you run).

```bash run
greeting="hi"
echo 'echo "child sees: [$greeting]"' > child.sh
bash child.sh
export greeting
bash child.sh
```

Common ones: `HOME`, `USER`, `PWD`, `PATH` (where commands are found), `SHELL`, `EDITOR`. `env` or `printenv` lists them.

```bash run
echo "$USER lives in $HOME and is in $PWD"
echo "$PATH" | tr ':' '\n'
```

A one-off variable for a single command: `LANG=C sort file`.

## Command substitution

`$(cmd)` captures a command's output into a value:

```bash run
today=$(date +%Y-%m-%d)
lines=$(wc -l < data/grades.txt)
top=$(sort -k2,2nr data/grades.txt | head -1 | cut -d' ' -f1)
echo "On $today, $lines students; top scorer: $top"
```

## Arithmetic

Bash does **integer** arithmetic inside `$(( ))`. Inside, you can omit the `$` on variable names.

```bash run
a=17; b=5
echo $((a + b)) $((a - b)) $((a * b)) $((a / b)) $((a % b)) $((a ** 2))
```

`(( ))` without the `$` is a command: it updates variables and its exit status is "true" when the result is non-zero, which makes it useful in conditions.

```bash run
i=0
((i++))
((i += 10))
echo "$i"
(( i > 5 )) && echo "big"
```

Bash has **no floating point**. `$((7 / 2))` is 3. For decimals use `bc` or awk:

```bash run
echo "scale=3; 7 / 2" | bc
awk 'BEGIN { printf "%.2f\n", 7 / 2 }'
```

## Parameter expansion

`${…}` can do far more than insert a value. These run inside the shell (no extra processes), which makes them fast and handy:

| Syntax | Result |
|---|---|
| `${var:-default}` | value, or `default` if unset/empty |
| `${var:=default}` | same, and also assigns the default |
| `${var:+alt}` | `alt` if var is set and non-empty, else empty |
| `${var:?message}` | error and exit if unset/empty |
| `${#var}` | length |
| `${var#pattern}` | remove the **shortest** match of pattern from the **start** |
| `${var##pattern}` | remove the **longest** match from the start |
| `${var%pattern}` | remove the shortest match from the **end** |
| `${var%%pattern}` | remove the longest match from the end |
| `${var/old/new}` | replace the first match |
| `${var//old/new}` | replace all matches |
| `${var:offset:length}` | substring (0-based) |
| `${var^^}` / `${var,,}` | uppercase / lowercase |

The patterns are **globs**, not regexes.

```bash run
path="/home/student/reports/q3.final.pdf"
echo "${path##*/}"     # basename:   q3.final.pdf
echo "${path%/*}"      # dirname:    /home/student/reports
echo "${path%.*}"      # drop last extension
echo "${path##*.}"     # extension:  pdf
file="${path##*/}"
echo "${file%%.*}"     # before the first dot: q3
```

> [!tip] Remembering # and %
> On a US keyboard `#` is left of `$` and `%` is right of it: `#` trims from the left (start), `%` from the right (end). Doubled means greedy (longest match).

```bash run
s="Hello, World"
echo "${#s} ${s:7} ${s:0:5} ${s,,} ${s^^} ${s/World/Bash}"
unset maybe
echo "${maybe:-fallback} [${maybe:+set}]"
```

:::quiz
q: What does `count = 5` do in bash?
- assigns 5 to count
+ tries to run a command named `count` with arguments `=` and `5`
- compares count to 5
- prints 5
why: Assignments must not have spaces around =.
:::

:::quiz
q: `x=7; echo $((x / 2))` prints…
- 3.5
+ 3
- 4
- an error
why: Bash arithmetic is integer-only and truncates.
:::

:::quiz
q: f="notes.tar.gz". What is `${f%.*}`?
+ `notes.tar`
- `notes`
- `gz`
- `tar.gz`
why: % removes the shortest match of `.*` from the end, which is ".gz". (%% would remove ".tar.gz".)
:::

:::quiz
q: Why might a child script not see a variable you set in your shell?
- variables can't contain letters
+ it wasn't exported to the environment
- child scripts can't read variables
- it needs to be uppercase
why: Only exported variables are copied into the environment of child processes.
:::

:::quiz
q: `echo "${name:-guest}"` when name is unset prints…
- nothing
- name
+ guest
- an error
why: :- substitutes the default when the variable is unset or empty.
:::

:::exercise
id: vr-assign
level: 1
title: Hello, variable
---
Set a variable `course` to `CSC 230` and print `Welcome to CSC 230!` using it.
---solution
course="CSC 230"
echo "Welcome to $course!"
:::

:::exercise
id: vr-arith
level: 1
title: Integer math
---
Set `w=12` and `h=7`, then print the area `w * h` using arithmetic expansion.
---solution
w=12
h=7
echo $((w * h))
:::

:::exercise
id: vr-cmdsub
level: 1
title: Capture a count
---
Store the number of lines in `todo.txt` in a variable `n` (use `wc -l <`), then print `You have N tasks` with the number.
---solution
n=$(wc -l < todo.txt)
echo "You have $n tasks"
:::

:::exercise
id: vr-braces
level: 2
title: Pluralize
---
Set `item=file` and `n=3`, then print `3 files` using `${…}` so the `s` sits right after the variable.
---solution
item=file
n=3
echo "$n ${item}s"
:::

:::exercise
id: vr-default
level: 2
title: Default value
---
Print `Hello, guest` using `${name:-guest}` when `name` is unset, then set `name=Ada` and print the same expression again (`Hello, Ada`). Two lines of output.
---solution
unset name
echo "Hello, ${name:-guest}"
name=Ada
echo "Hello, ${name:-guest}"
:::

:::exercise
id: vr-basename
level: 2
title: Parse a path
---
Given `p=/home/student/data/employees.csv`, print three lines using only parameter expansion: the file name (`employees.csv`), the directory (`/home/student/data`), and the extension (`csv`).
---solution
p=/home/student/data/employees.csv
echo "${p##*/}"
echo "${p%/*}"
echo "${p##*.}"
:::

:::exercise
id: vr-length-case
level: 2
title: Length and case
---
With `word=bash`, print `BASH has 4 letters`, computing both the uppercase form and the length with parameter expansion.
---solution
word=bash
echo "${word^^} has ${#word} letters"
:::

:::exercise
id: vr-replace
level: 3
title: Snake to kebab
---
Given `id=report_final_v2_draft`, print it with **every** underscore replaced by a hyphen.
---solution
id=report_final_v2_draft
echo "${id//_/-}"
:::

:::exercise
id: vr-average
level: 3
title: Average with bash and bc
---
Compute the **total** of all scores in `data/grades.txt` with awk into a variable `total`, the count of lines into `n`, then print the average with 2 decimals using `bc` (`scale=2`).
---solution
total=$(awk '{ s += $2 } END { print s }' data/grades.txt)
n=$(wc -l < data/grades.txt)
echo "scale=2; $total / $n" | bc
:::

:::exercise
id: vr-substring
level: 3
title: Pull the year apart
---
Given `d=2026-10-22`, print the year, month and day on one line separated by slashes in **US order** (`10/22/2026`) using substring expansion `${d:offset:length}`.
---solution
d=2026-10-22
echo "${d:5:2}/${d:8:2}/${d:0:4}"
:::

:::exercise
id: vr-export
level: 3
title: Pass it down
---
Create a script `show.sh` containing `echo "MODE is [$MODE]"`. Then set `MODE=debug` **without** exporting and run `bash show.sh`; then export it and run `bash show.sh` again. (Two lines of output.)
---solution
echo 'echo "MODE is [$MODE]"' > show.sh
MODE=debug
bash show.sh
export MODE
bash show.sh
:::

:::exercise
id: vr-rename-ext
level: 4
title: Change every extension
---
For each file in `data/` ending in `.txt`, print the name it would have with a `.md` extension instead, one per line, like `contacts.md`. Use a `for` loop over `data/*.txt` and parameter expansion (no sed).
---hint
`for f in data/*.txt; do b="${f##*/}"; echo "${b%.txt}.md"; done`
---solution
for f in data/*.txt; do
  b="${f##*/}"
  echo "${b%.txt}.md"
done
:::

:::exercise
id: vr-percent
level: 4
title: Disk-free style percentage
---
Count the files in `photos` (`n`) and how many of them are `.jpg` (`j`), then print `6 of 8 photos are JPEGs (75%)` with an **integer** percentage computed in bash arithmetic.
---solution
n=$(ls photos | wc -l)
j=$(ls photos/*.jpg | wc -l)
echo "$j of $n photos are JPEGs ($((j * 100 / n))%)"
:::
