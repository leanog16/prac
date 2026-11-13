---
id: bash-boss
title: Boss round: real scripts
summary: Multi-step scripts that combine pipelines, conditionals, loops, functions and arrays — the kind of tasks you'll actually automate.
minutes: 60
---
## Thinking like a shell programmer

Real scripts are glue: they move data between tools. A good approach:

1. **Do it by hand first.** Type the pipeline in a terminal until the output is right.
2. **Parameterize.** Replace hard-coded names with `$1`, `"$@"`, variables.
3. **Guard the edges.** Missing arguments, missing files, empty input. Print usage to stderr and exit non-zero.
4. **Prefer the right tool.** Line filtering → grep. Column math → awk. Substitution → sed. Control flow → bash. Don't write a bash loop to sum a column; don't write awk to rename files.
5. **Quote everything.** `"$file"`, `"$@"`, `"$(cmd)"`.

A complete small script, in the style the exercises below expect:

```bash run
cat > top.sh <<'EOF'
#!/bin/bash
# top.sh FILE [N] - show the N most common lines of FILE (default 3)
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: top.sh FILE [N]" >&2
  exit 1
fi
file=$1
n=${2:-3}
if [ ! -f "$file" ]; then
  echo "top.sh: $file: no such file" >&2
  exit 2
fi

sort "$file" | uniq -c | sort -k1,1nr -k2,2 | head -n "$n"
EOF
bash top.sh data/words.txt
bash top.sh data/words.txt 1
bash top.sh nope.txt; echo "exit status: $?"   # fails on purpose
```

> [!tip] Reading the exercises
> Every boss exercise is a script graded against several test invocations. Click **Expected output** to see exactly what each test should print; that's your spec.

:::exercise
id: bb-log-summary
level: 3
title: Log level summary
mode: script
---
Write a script that takes a log file path and prints how many lines it has at each level (`INFO`, `WARN`, `ERROR`, `DEBUG`) in exactly this format and order, including zero counts:

```
INFO: 25
WARN: 9
ERROR: 6
DEBUG: 5
```
(Numbers will vary with the file.) Lines look like `2026-10-20 08:00:00 INFO  [api] …`: the level is the third whitespace-separated field.
---test
args: logs/app.log
---solution
#!/bin/bash
for level in INFO WARN ERROR DEBUG; do
  echo "$level: $(awk -v l="$level" '$3 == l' "$1" | wc -l)"
done
:::

:::exercise
id: bb-dept-report
level: 3
title: Department salary report
mode: script
---
Write a script that takes a department name and prints, from `data/employees.csv`: a line `DEPT: N employees`, then each employee in that department as `  NAME SALARY` sorted by salary descending, then `  average: AVG` with the average salary rounded down to an integer. If the department has no employees, print only `no employees in DEPT`.
---test
args: Engineering
---test
args: Support
---test
args: Legal
---solution
#!/bin/bash
dept=$1
rows=$(awk -F, -v d="$dept" 'NR > 1 && $3 == d { print $2 "," $4 }' data/employees.csv)
if [ -z "$rows" ]; then
  echo "no employees in $dept"
  exit 0
fi
n=$(echo "$rows" | wc -l)
echo "$dept: $n employees"
echo "$rows" | sort -t, -k2,2nr | awk -F, '{ print "  " $1, $2 }'
echo "$rows" | awk -F, '{ s += $2 } END { printf "  average: %d\n", s / NR }'
:::

:::exercise
id: bb-backup
level: 3
title: Timestamped backups
mode: script
---
Write a script that takes one or more file names. For each, copy it into `archive/` as `NAME.bak` and print `backed up NAME`. If a file doesn't exist, print `skipped NAME (missing)` and keep going. At the end print `done: N backed up, M skipped`.
---test
args: notes.txt todo.txt
---test
args: notes.txt ghost.txt data/grades.txt
---solution
#!/bin/bash
ok=0; skip=0
mkdir -p archive
for f in "$@"; do
  if [ -f "$f" ]; then
    cp "$f" "archive/$(basename "$f").bak"
    echo "backed up $f"
    ((ok++))
  else
    echo "skipped $f (missing)"
    ((skip++))
  fi
done
echo "done: $ok backed up, $skip skipped"
:::

:::exercise
id: bb-config-get
level: 3
title: Read an INI value
mode: script
status: true
---
Write `script.sh SECTION KEY` that prints the value of KEY within `[SECTION]` of `data/config.ini`. If the key isn't found in that section, print nothing and exit with status 1.
---hint
awk with a flag: when a line is `[SECTION]` set `in=1`; any other `[...]` sets `in=0`; when `in` and the line starts with `KEY=`, print what follows the `=`.
---test
args: database port
---test
args: server host
---test
args: cache port
---test
args: server password
---solution
#!/bin/bash
val=$(awk -F= -v s="[$1]" -v k="$2" '
  /^\[/ { inside = ($0 == s); next }
  inside && $1 == k { print $2; exit }
' data/config.ini)
if [ -z "$val" ]; then
  exit 1
fi
echo "$val"
:::

:::exercise
id: bb-organize-ext
level: 4
title: Sort files by extension
mode: script
---
Write a script that takes a directory and **reports** (doesn't move anything) how many files it contains per extension, lowercase, sorted by extension, formatted `ext: N`. Files without an extension count as `none`.
---test
args: downloads
---test
args: photos
---test
args: data
---solution
#!/bin/bash
declare -A n
for f in "$1"/*; do
  [ -f "$f" ] || continue
  base=${f##*/}
  if [[ $base == *.* ]]; then ext=${base##*.}; ext=${ext,,}; else ext=none; fi
  n[$ext]=$(( ${n[$ext]:-0} + 1 ))
done
for e in "${!n[@]}"; do echo "$e: ${n[$e]}"; done | sort
:::

:::exercise
id: bb-access-report
level: 4
title: Web traffic report
mode: script
---
Write a script that analyzes an access log (argument) and prints:

```
requests: N
unique clients: N
errors (4xx/5xx): N
top path: PATH (N)
```

The status code is field 9 and the path is field 7 (space-separated). For the top path, ties are broken alphabetically.
---test
args: logs/access.log
---solution
#!/bin/bash
log=$1
echo "requests: $(wc -l < "$log")"
echo "unique clients: $(cut -d' ' -f1 "$log" | sort -u | wc -l)"
echo "errors (4xx/5xx): $(awk '$9 >= 400' "$log" | wc -l)"
read -r count path < <(cut -d' ' -f7 "$log" | sort | uniq -c | sort -k1,1nr -k2,2 | head -n 1)
echo "top path: $path ($count)"
:::

:::exercise
id: bb-validate-csv
level: 4
title: CSV validator
mode: script
status: true
---
Write a script that validates a CSV file (argument): every line must have the same number of comma-separated fields as the header. Print `line N: expected X fields, got Y` for each bad line. If all lines are fine print `OK: N rows` (data rows, excluding the header). Exit 0 if valid, 1 otherwise.

The grader runs your script on two files the setup creates: `good.csv` (a copy of `data/employees.csv`) and `bad.csv`.
---setup
cp data/employees.csv good.csv
printf 'a,b,c\n1,2,3\n4,5\n6,7,8,9\n10,11,12\n' > bad.csv
---test
args: good.csv
---test
args: bad.csv
---solution
#!/bin/bash
awk -F, '
  NR == 1 { want = NF; next }
  NF != want { printf "line %d: expected %d fields, got %d\n", NR, want, NF; bad = 1 }
  END { if (!bad) printf "OK: %d rows\n", NR - 1; exit bad }
' "$1"
:::

:::exercise
id: bb-password
level: 4
title: Password strength checker
mode: script
status: true
---
Write a script that checks its argument as a password and prints a line for each failed rule, then `strong` or `weak`. Rules, checked in this order:

1. at least 8 characters → else `too short`
2. contains a digit → else `needs a digit`
3. contains an uppercase letter → else `needs an uppercase letter`
4. contains one of `!@#$%^&*` → else `needs a symbol`

Print `strong` and exit 0 if every rule passes; otherwise print `weak` last and exit 1.
---test
args: 'Tr0ub4dor&3'
---test
args: 'password'
---test
args: 'Ab1!'
---test
args: 'LongPassword1'
---solution
#!/bin/bash
p=$1
ok=1
(( ${#p} >= 8 )) || { echo "too short"; ok=0; }
[[ $p =~ [0-9] ]] || { echo "needs a digit"; ok=0; }
[[ $p =~ [A-Z] ]] || { echo "needs an uppercase letter"; ok=0; }
[[ $p == *[\!@#\$%^\&\*]* ]] || { echo "needs a symbol"; ok=0; }
if (( ok )); then echo strong; else echo weak; exit 1; fi
:::

:::exercise
id: bb-todo-cli
level: 4
title: A tiny todo CLI
mode: script
status: true
stderr: true
---
Build `script.sh COMMAND [ARGS]` operating on `todo.txt`:

- `list`: print each task numbered as `N. TASK`
- `add TEXT…`: append `[med] TEXT` (all remaining args joined by spaces) and print `added: [med] TEXT`
- `done N`: remove line N and print `completed: TASK`; if N is out of range print `no task N` to stderr and exit 1
- `count`: print the number of `[high]` tasks as `N high-priority`
- anything else: print `usage: script.sh list|add|done|count` to stderr and exit 2
---test
args: list
---test
args: add call the dentist
---test
args: done 2
---test
args: done 99
---test
args: count
---test
args: frobnicate
---solution
#!/bin/bash
f=todo.txt
cmd=$1; shift
case "$cmd" in
  list)
    awk '{ print NR ". " $0 }' "$f" ;;
  add)
    echo "[med] $*" >> "$f"
    echo "added: [med] $*" ;;
  done)
    n=$1
    total=$(wc -l < "$f")
    if [ -z "$n" ] || (( n < 1 || n > total )); then
      echo "no task $n" >&2
      exit 1
    fi
    echo "completed: $(sed -n "${n}p" "$f")"
    sed -i "${n}d" "$f" ;;
  count)
    echo "$(grep -c '^\[high\]' "$f") high-priority" ;;
  *)
    echo "usage: script.sh list|add|done|count" >&2
    exit 2 ;;
esac
:::

:::exercise
id: bb-histogram
level: 4
title: Grade histogram
mode: script
---
Print a histogram of scores from a grades file (argument; lines are `name score`) in buckets `90s`, `80s`, `70s`, `60s`, `<60`, in that order, each with a bar of `#` characters, one per student, like:

```
90s | ###
80s | ###
```
Print every bucket even when it's empty (the bar is then empty: `<60 | `).
---test
args: data/grades.txt
---solution
#!/bin/bash
declare -A c=([90s]=0 [80s]=0 [70s]=0 [60s]=0 ['<60']=0)
while read -r name score; do
  if (( score >= 90 )); then b=90s
  elif (( score >= 80 )); then b=80s
  elif (( score >= 70 )); then b=70s
  elif (( score >= 60 )); then b=60s
  else b='<60'; fi
  c[$b]=$(( ${c[$b]} + 1 ))
done < "$1"
for b in 90s 80s 70s 60s '<60'; do
  bar=""
  for ((i = 0; i < ${c[$b]}; i++)); do bar+="#"; done
  printf "%-3s | %s\n" "$b" "$bar"
done
:::

:::exercise
id: bb-stock-alerts
level: 3
title: Low-stock alerts
mode: script
---
Write a script that reads `data/inventory.tsv` and takes a threshold argument (default `5`). For each item with quantity **below** the threshold print `REORDER sku item (qty N)`; print `OUT sku item` instead when the quantity is 0. Finish with `N items need attention`.
---test
args:
---test
args: 20
---test
args: 1
---solution
#!/bin/bash
t=${1:-5}
n=0
while IFS=$'\t' read -r sku item qty price; do
  if (( qty == 0 )); then
    echo "OUT $sku $item"; ((n++))
  elif (( qty < t )); then
    echo "REORDER $sku $item (qty $qty)"; ((n++))
  fi
done < <(tail -n +2 data/inventory.tsv)
echo "$n items need attention"
:::
