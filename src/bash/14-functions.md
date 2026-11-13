---
id: bash-func
title: Functions & arrays
summary: Defining functions, arguments and local variables, returning values (echo vs return), indexed arrays, associative arrays, mapfile, and getopts for option parsing.
minutes: 35
---
> [!project] logwatch, step 14: functions and options
> `logwatch.sh` now does several jobs. Functions give each job a name, and `getopts` gives the script real command-line options like `-n 5` and `-l WARN`, just like the tools you've been using.

## Defining functions

```bash
name() {
  commands
}
```

(`function name { … }` also works.) A function must be defined before it's called. It behaves like a mini-script: its arguments are `$1`, `$2`, `$#`, `"$@"`, which temporarily shadow the script's own.

```bash run
greet() {
  echo "Hello, $1! You passed $# argument(s)."
}
greet Ada
greet "Grace Hopper" extra
```

## Local variables

Variables in bash are **global by default**, even inside functions. Use `local` to keep a variable private to the function:

```bash run
counter=10
bump() {
  local counter=0
  counter=$((counter + 1))
  echo "inside: $counter"
}
bump
echo "outside: $counter"
```

Without `local`, `bump` would have overwritten the global. Make `local` a habit.

## Returning values

`return N` sets the function's **exit status** (0–255): it's for success/failure, not data. To return *data*, **print it** and capture with `$( )`:

```bash run
is_even() {
  (( $1 % 2 == 0 ))      # exit status of the last command is the return status
}
square() {
  echo $(( $1 * $1 ))
}

is_even 4 && echo "4 is even"
is_even 7 || echo "7 is odd"
result=$(square 12)
echo "12 squared is $result"
```

> [!exam] echo vs return
> `return 144` doesn't give you 144 as a value; it sets `$?` (and anything over 255 wraps around). Data comes out through stdout: `x=$(f)`. Status comes out through return: `if f; then …`.

Functions can call each other and recurse:

```bash run
fact() {
  if (( $1 <= 1 )); then echo 1; return; fi
  echo $(( $1 * $(fact $(( $1 - 1 ))) ))
}
fact 6
```

## Indexed arrays

```bash run
fruits=(apple banana "dragon fruit")
echo "first: ${fruits[0]}"
echo "count: ${#fruits[@]}"
fruits+=(kiwi)
for f in "${fruits[@]}"; do echo "- $f"; done
echo "indexes: ${!fruits[@]}"
echo "slice: ${fruits[@]:1:2}"
```

| Syntax | Meaning |
|---|---|
| `arr=(a b c)` | create |
| `${arr[i]}` | element i (0-based) |
| `"${arr[@]}"` | all elements, each a separate word |
| `${#arr[@]}` | number of elements |
| `${!arr[@]}` | the indexes |
| `arr+=(x y)` | append |
| `arr[i]=v` | set one element |
| `unset 'arr[i]'` | remove one element |
| `${arr[@]:start:len}` | slice |

> [!warn] Always "${arr[@]}"
> Like `"$@"`, the quoted `"${arr[@]}"` keeps elements with spaces intact. `${arr[*]}` or unquoted forms re-split them.

### Filling arrays from commands

```bash run
mapfile -t names < <(cut -d' ' -f1 data/grades.txt)
echo "${#names[@]} names; last is ${names[-1]}"

csvs=(data/*.csv)
echo "found ${#csvs[@]} CSV files: ${csvs[*]}"
```

`mapfile -t arr < file` (also `readarray`) reads lines into an array, `-t` removing the newlines.

## Associative arrays

Declare with `declare -A`. Keys are strings: bash's dictionary.

```bash run
declare -A capital=([NC]=Raleigh [TX]=Austin [WA]=Olympia)
capital[MA]=Boston
echo "NC -> ${capital[NC]}"
for state in "${!capital[@]}"; do
  echo "$state: ${capital[$state]}"
done | sort
```

Counting with an associative array, bash-only (no awk):

```bash run
declare -A count
while read -r word; do
  count[$word]=$(( ${count[$word]:-0} + 1 ))
done < data/words.txt
for w in "${!count[@]}"; do echo "${count[$w]} $w"; done | sort -rn | head -3
```

## Parsing options with getopts

`getopts` parses short options (`-v`, `-n 5`) the standard way. A colon after a letter means it takes a value.

```bash run
cat > opts.sh <<'EOF'
verbose=0; count=1
while getopts "vn:" opt; do
  case $opt in
    v) verbose=1 ;;
    n) count=$OPTARG ;;
    *) echo "usage: opts.sh [-v] [-n N] args" >&2; exit 1 ;;
  esac
done
shift $((OPTIND - 1))
echo "verbose=$verbose count=$count rest=$*"
EOF
bash opts.sh -v -n 3 file1 file2
bash opts.sh file3
```

## Worked example: one function per job

```bash title=logwatch.sh
#!/bin/bash
set -euo pipefail

count_level() {             # count_level LEVEL FILE
  local level="$1" file="$2"
  grep -c "$level" "$file" || true
}

top_ips() {                 # top_ips N FILE
  local n="$1" file="$2"
  cut -d' ' -f1 "$file" | sort | uniq -c | sort -rn | head -n "$n"
}

main() {
  echo "errors: $(count_level ERROR logs/app.log)"
  echo "top clients:"
  top_ips 3 logs/access.log
}

main "$@"
```

- Functions take arguments exactly like scripts: `$1`, `$2`, `$#`, `"$@"`.
- **`local`** keeps variables inside the function. Without it, every variable is global and functions quietly overwrite each other's.
- A function "returns" data by **printing** it (capture with `$(…)`), and success or failure with `return N`.
- Wrapping the top level in `main "$@"` keeps the script readable from top to bottom.

## Worked example: options with getopts

```bash
n=3; level=ERROR
while getopts ":n:l:h" opt; do
  case "$opt" in
    n) n="$OPTARG" ;;
    l) level="$OPTARG" ;;
    h) usage; exit 0 ;;
    :) echo "option -$OPTARG needs a value" >&2; exit 2 ;;
    \?) echo "unknown option -$OPTARG" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))          # what's left in "$@" are the file arguments
```

In `":n:l:h"`, a colon **after** a letter means "takes a value"; the leading colon lets you print your own error messages.

> [!plain] In plain English
> A function is a named mini-script inside your script. `getopts` reads the `-x value` flags one at a time so you don't have to parse `$1`, `$2` by hand.

## Common mistakes

> [!mistake] Using `return` to send back text
> `return` only takes a number from 0 to 255 (a status). To return a string, `echo` it and capture the output.

:::quiz
q: How do you get a computed value *out* of a bash function?
- `return value`, then read `$value`
+ print it with echo and capture with `$(func)`
- assign to `$0`
- functions can't produce values
why: return only sets the 0–255 exit status. Output is the data channel.
:::

:::quiz
q: Without `local`, a variable assigned inside a function is…
+ global: visible (and overwritten) outside the function
- discarded when the function returns
- an error
- read-only
why: Bash variables are global unless declared local.
:::

:::quiz
q: `arr=(a "b c" d)`. What is `${#arr[@]}`?
- 4
+ 3
- 5
- 1
why: Quotes keep "b c" as one element.
:::

:::quiz
q: Which loops over the *keys* of associative array `m`?
- `for k in "${m[@]}"`
+ `for k in "${!m[@]}"`
- `for k in ${#m[@]}`
- `for k in $m`
why: ${!m[@]} expands to the keys; ${m[@]} to the values.
:::

:::quiz
q: In `getopts "ab:c" opt`, which option requires a value?
- a
+ b
- c
- all of them
why: A colon after a letter marks an option that takes an argument (available as $OPTARG).
:::

:::exercise
id: fn-greet
level: 1
title: A greeting function
---
Define a function `greet` that prints `Hi, NAME!` for its first argument, then call it with `Ada` and with `Linus`.
---solution
greet() { echo "Hi, $1!"; }
greet Ada
greet Linus
:::

:::exercise
id: fn-array-basic
level: 1
title: Array basics
---
Create an array `langs` with `bash`, `sql`, `python`. Print the second element, then the number of elements (two lines).
---solution
langs=(bash sql python)
echo "${langs[1]}"
echo "${#langs[@]}"
:::

:::exercise
id: fn-array-loop
level: 1
title: Loop an array
---
Create an array `days` containing `Mon`, `Wed` and `Fri`, and print each element on its own line, prefixed with `- `.
---solution
days=(Mon Wed Fri)
for d in "${days[@]}"; do echo "- $d"; done
:::

:::exercise
id: fn-return-value
level: 2
title: Return a value
---
Write a function `area` that **prints** the area of a rectangle given width and height arguments. Capture `area 7 6` into a variable `a` and print `area is 42` using it.
---solution
area() { echo $(( $1 * $2 )); }
a=$(area 7 6)
echo "area is $a"
:::

:::exercise
id: fn-predicate
level: 2
title: A predicate function
---
Write `is_big` which **succeeds** (exit status 0) when its argument is greater than 100. Then for each of `50 150 101 100`, print `N big` or `N small` using `if is_big N`.
---solution
is_big() { (( $1 > 100 )); }
for n in 50 150 101 100; do
  if is_big "$n"; then echo "$n big"; else echo "$n small"; fi
done
:::

:::exercise
id: fn-local
level: 2
title: Keep it local
---
Run this, then fix `double` with `local` so that the final line prints `x is still 5`:

```bash
x=5
double() { x=$(( $1 * 2 )); echo "$x"; }
double 21
echo "x is still $x"
```
---solution
x=5
double() { local x=$(( $1 * 2 )); echo "$x"; }
double 21
echo "x is still $x"
:::

:::exercise
id: fn-assoc
level: 3
title: Phone book
---
Create an associative array `ext` mapping `alice` → `4102`, `bob` → `4217`, `carol` → `4330`. Then print `bob: 4217`, and finally print all `name: ext` pairs sorted by name.
---solution
declare -A ext=([alice]=4102 [bob]=4217 [carol]=4330)
echo "bob: ${ext[bob]}"
for k in "${!ext[@]}"; do echo "$k: ${ext[$k]}"; done | sort
:::

:::exercise
id: fn-mapfile
level: 3
title: Load lines into an array
---
Use `mapfile -t` to load `todo.txt` into an array `tasks`, then print `N tasks; first: FIRST; last: LAST`.
---solution
mapfile -t tasks < todo.txt
echo "${#tasks[@]} tasks; first: ${tasks[0]}; last: ${tasks[-1]}"
:::

:::exercise
id: fn-sum-args
level: 3
title: Sum any number of arguments
mode: script
---
Write a script with a function `sum` that adds up all of its arguments and prints the total. The script should call `sum "$@"`.
---test
args: 1 2 3 4
---test
args: 10
---test
args:
---solution
#!/bin/bash
sum() {
  local total=0 n
  for n in "$@"; do (( total += n )); done
  echo "$total"
}
sum "$@"
:::

:::exercise
id: fn-max-array
level: 3
title: Largest in an array
---
Given `nums=(42 7 93 18 93 5)`, print the largest value and how many times it occurs, as `93 x2`.
---solution
nums=(42 7 93 18 93 5)
max=${nums[0]}
for n in "${nums[@]}"; do (( n > max )) && max=$n; done
c=0
for n in "${nums[@]}"; do (( n == max )) && ((c++)); done
echo "$max x$c"
:::

:::exercise
id: fn-word-count-assoc
level: 4
title: Word count in pure bash
---
Count the words in `data/words.txt` using an associative array (no `sort | uniq`, no awk for counting), then print `WORD COUNT` lines for words that appear **at least twice**, sorted alphabetically.
---hint
`${count[$w]:-0}` gives 0 for unseen words. You may pipe the final output through `sort`.
---solution
declare -A count
while read -r w; do
  count[$w]=$(( ${count[$w]:-0} + 1 ))
done < data/words.txt
for w in "${!count[@]}"; do
  (( count[$w] >= 2 )) && echo "$w ${count[$w]}"
done | sort
:::

:::exercise
id: fn-getopts
level: 4
title: Options with getopts
mode: script
---
Write a script that accepts `-u` (uppercase the output) and `-r N` (repeat N times, default 1), followed by a message. Print the message N times, one per line, uppercased if `-u` was given.
---test
args: hello
---test
args: -u hello there
---test
args: -r 3 hi
---test
args: -u -r 2 bye
---solution
#!/bin/bash
upper=0; reps=1
while getopts "ur:" opt; do
  case $opt in
    u) upper=1 ;;
    r) reps=$OPTARG ;;
  esac
done
shift $((OPTIND - 1))
msg="$*"
(( upper )) && msg="${msg^^}"
for ((i = 0; i < reps; i++)); do echo "$msg"; done
:::

:::exercise
id: fn-recursive
level: 4
title: Recursive Fibonacci
mode: script
---
Write a recursive function `fib` (fib 0 = 0, fib 1 = 1, fib n = fib(n-1) + fib(n-2)) and print `fib N` for the argument N.
---test
args: 0
---test
args: 1
---test
args: 10
---solution
#!/bin/bash
fib() {
  local n=$1
  if (( n < 2 )); then echo "$n"; return; fi
  echo $(( $(fib $((n - 1))) + $(fib $((n - 2))) ))
}
fib "$1"
:::

:::exercise
id: proj-bash-14-functions
level: 3
title: "Project 14: logwatch with functions"
mode: script
---
Write a script with a function `count_level LEVEL FILE` (uses `local`, prints how many lines of FILE contain LEVEL). The script calls it for `ERROR`, `WARN` and `INFO` on the file given as `$1`, printing `ERROR=N`, `WARN=N`, `INFO=N` on three lines.
---test
args: logs/app.log
---solution
#!/bin/bash
count_level() {
  local level="$1" file="$2"
  grep -c "$level" "$file"
}
for lvl in ERROR WARN INFO; do
  echo "$lvl=$(count_level "$lvl" "$1")"
done
:::

:::exercise
id: proj-bash-14-getopts
level: 4
title: "Project 14b: logwatch top -n"
mode: script
---
Write a script that accepts an option `-n N` (default 3) followed by a log file, and prints the top N client IPs of that access log with their counts (as `uniq -c | sort -rn | head` prints them). Use `getopts` and `shift`.
---test
args: logs/access.log
---test
args: -n 1 logs/access.log
---test
args: -n 5 logs/access.log
---solution
#!/bin/bash
n=3
while getopts "n:" opt; do
  case "$opt" in
    n) n="$OPTARG" ;;
  esac
done
shift $((OPTIND - 1))
cut -d' ' -f1 "$1" | sort | uniq -c | sort -rn | head -n "$n"
:::
