---
id: bash-loops
title: Loops
summary: for loops over lists, globs, ranges and arguments; C-style for; while and until; reading files line by line with while read; break and continue; the subshell pitfall.
minutes: 35
---
## for … in

`for VAR in WORDS; do …; done` runs the body once per word.

```bash run
for fruit in apple banana cherry; do
  echo "I like $fruit"
done
```

The word list can come from any expansion:

| Source | Example |
|---|---|
| literal words | `for x in a b c` |
| brace range | `for i in {1..5}` |
| glob | `for f in data/*.csv` |
| command output | `for u in $(cut -d' ' -f1 data/grades.txt)` |
| arguments | `for a in "$@"` (or just `for a`) |
| array | `for x in "${arr[@]}"` |

```bash run
for f in data/*.txt; do
  echo "$f has $(wc -l < "$f") lines"
done
```

> [!warn] Looping over command output splits on whitespace
> `for line in $(cat file)` iterates over **words**, not lines, and also globs them. To process lines, use `while read` (below). Looping over a glob (`for f in *.txt`) is safe even with spaces in names, as long as you quote `"$f"` inside.

## C-style for

```bash run
for ((i = 1; i <= 5; i++)); do
  echo "$i squared is $((i * i))"
done
```

## while and until

`while CONDITION; do …; done` repeats while the condition command succeeds. `until` repeats while it fails.

```bash run
n=1
while (( n < 100 )); do
  n=$((n * 3))
done
echo "first power of 3 above 100: $n"
```

```bash run
count=3
until (( count == 0 )); do
  echo "T-minus $count"
  ((count--))
done
echo "liftoff"
```

## Reading a file line by line

The canonical idiom:

```bash
while IFS= read -r line; do
  ...
done < file
```

- `read -r` keeps backslashes literal.
- `IFS=` keeps leading/trailing whitespace.
- `< file` at the `done` feeds the whole loop.

`read` can split each line into several variables using `IFS`; the last variable gets the rest of the line:

```bash run
while read -r name score; do
  if (( score >= 90 )); then
    echo "$name: honors"
  fi
done < data/grades.txt
```

```bash run
tail -n +2 data/employees.csv | while IFS=, read -r id name dept salary year city; do
  echo "$name ($dept) - $city"
done | head -4
```

> [!exam] The subshell trap
> Each side of a pipe runs in a **subshell**. Variables changed inside `cat file | while read …; do count=$((count+1)); done` vanish when the loop ends, so `count` is still 0 afterwards. Redirect instead: `while read …; done < file`.

```bash run
count=0
cat data/grades.txt | while read -r n s; do count=$((count + 1)); done
echo "after pipe: $count"
count=0
while read -r n s; do count=$((count + 1)); done < data/grades.txt
echo "after redirect: $count"
```

## break and continue

`break` leaves the loop; `continue` skips to the next iteration. Both take an optional number for nested loops (`break 2`).

```bash run
for i in {1..20}; do
  (( i % 2 == 0 )) && continue
  (( i > 9 )) && break
  echo -n "$i "
done
echo
```

## Loops in pipelines

A loop's output can be piped and redirected like any command:

```bash run
for i in {1..5}; do echo $((RANDOM % 100)); done | sort -n | tail -1
```

```bash run
for d in data logs photos; do
  printf "%-8s %3d files\n" "$d" "$(ls "$d" | wc -l)"
done > summary.txt
cat summary.txt
```

## Common loop recipes

```bash
# rename *.txt to *.md
for f in *.txt; do mv "$f" "${f%.txt}.md"; done

# retry a command up to 5 times
for i in {1..5}; do some_command && break; sleep 1; done

# process arguments
for arg in "$@"; do echo "got: $arg"; done
```

:::quiz
q: What does `for x in $(echo "a b" "c"); do echo $x; done` print?
- two lines: "a b" and "c"
+ three lines: a, b, c
- one line: a b c
- nothing
why: Unquoted command substitution is split on whitespace into words.
:::

:::quiz
q: Which reads a file one line at a time, preserving backslashes and leading spaces?
- `for line in $(cat file)`
+ `while IFS= read -r line; do …; done < file`
- `while read line < file; do …; done`
- `cat file | for line; do …; done`
why: The `done < file` form feeds the whole loop; IFS= and -r keep the line intact. (`read line < file` would reopen the file and read the first line forever.)
:::

:::quiz
q: Why is `count` still 0 after `cat f | while read l; do ((count++)); done`?
- read doesn't work with pipes
+ the while loop runs in a subshell, so its variable changes are lost
- ((count++)) is invalid
- the file is empty
why: Pipeline stages run in subshells. Use `done < f` instead.
:::

:::quiz
q: `continue` inside a loop…
- exits the loop
+ skips the rest of this iteration and starts the next
- restarts the loop from the beginning
- pauses the script
why: break exits; continue moves on to the next iteration.
:::

:::exercise
id: lp-count
level: 1
title: Count to ten
---
Print the numbers 1 through 10, one per line, with a `for` loop.
---solution
for i in {1..10}; do echo "$i"; done
:::

:::exercise
id: lp-list
level: 1
title: Greet the team
---
Loop over the names `Ana`, `Bo` and `Cy`, printing `Hi, NAME` for each.
---solution
for n in Ana Bo Cy; do echo "Hi, $n"; done
:::

:::exercise
id: lp-cstyle
level: 1
title: Countdown by twos
---
Use a C-style for loop to print `10 8 6 4 2 0` on a single line (numbers separated by spaces, then a newline).
---solution
for ((i = 10; i >= 0; i -= 2)); do echo -n "$i "; done; echo
:::

:::exercise
id: lp-files
level: 2
title: Size up the logs
---
For every `.log` file in `logs/`, print `NAME: N lines` where NAME is just the file name (no directory) and N is its line count.
---solution
for f in logs/*.log; do
  echo "${f##*/}: $(wc -l < "$f") lines"
done
:::

:::exercise
id: lp-while-sum
level: 2
title: Sum until 100
---
Using a `while` loop, add 1 + 2 + 3 + … until the total **exceeds 100**, then print `N TOTAL` (the last number added and the total).
---solution
n=0; total=0
while (( total <= 100 )); do
  ((n++))
  ((total += n))
done
echo "$n $total"
:::

:::exercise
id: lp-read-grades
level: 2
title: Passed or failed
---
Read `data/grades.txt` line by line with `while read` and print `NAME: pass` for scores 70 or above and `NAME: fail` otherwise.
---solution
while read -r name score; do
  if (( score >= 70 )); then
    echo "$name: pass"
  else
    echo "$name: fail"
  fi
done < data/grades.txt
:::

:::exercise
id: lp-csv-read
level: 2
title: Who's in Raleigh?
---
Read `data/employees.csv` (skip the header) with `while IFS=, read -r …` and print the names of employees in `Raleigh`.
---solution
tail -n +2 data/employees.csv | while IFS=, read -r id name dept salary year city; do
  [ "$city" = "Raleigh" ] && echo "$name"
done
:::

:::exercise
id: lp-fizzbuzz
level: 3
title: FizzBuzz
---
Print the numbers 1 to 20, but `Fizz` for multiples of 3, `Buzz` for multiples of 5, and `FizzBuzz` for multiples of both.
---solution
for i in {1..20}; do
  if (( i % 15 == 0 )); then echo FizzBuzz
  elif (( i % 3 == 0 )); then echo Fizz
  elif (( i % 5 == 0 )); then echo Buzz
  else echo "$i"
  fi
done
:::

:::exercise
id: lp-break
level: 3
title: First failing student
---
Read `data/grades.txt` in order and print the name of the **first** student with a score below 65, then stop reading.
---solution
while read -r name score; do
  if (( score < 65 )); then
    echo "$name"
    break
  fi
done < data/grades.txt
:::

:::exercise
id: lp-counter
level: 3
title: Count without a pipe
---
Count how many servers in `data/servers.txt` are `down`, using a `while read` loop that increments a variable, and print `down: N` after the loop. (Make sure the variable survives the loop.)
---solution
down=0
while read -r name ip status; do
  [ "$status" = "down" ] && ((down++))
done < data/servers.txt
echo "down: $down"
:::

:::exercise
id: lp-rename
level: 3
title: Batch rename
compare: verify
---
Rename every `.jpg` file in `photos/` from `IMG_000N.jpg` to `vacation-N.jpg` (e.g. `IMG_0003.jpg` → `vacation-3.jpg`).
---hint
Inside the loop, strip the prefix and suffix with `${f#photos/IMG_000}` and `${n%.jpg}`.
---verify
ls photos
---solution
for f in photos/IMG_*.jpg; do
  n=${f#photos/IMG_000}
  n=${n%.jpg}
  mv "$f" "photos/vacation-$n.jpg"
done
:::

:::exercise
id: lp-multiplication
level: 3
title: Times table
---
Print a 5×5 multiplication table using nested loops: each row has the products separated by tabs (`printf '%d\t'`), ending with a newline.
---solution
for i in {1..5}; do
  for j in {1..5}; do
    printf '%d\t' $((i * j))
  done
  echo
done
:::

:::exercise
id: lp-collatz
level: 4
title: Collatz steps
mode: script
---
Write a script that takes a positive integer N and prints how many steps the Collatz process takes to reach 1 (if even, halve it; if odd, 3N+1).
---test
args: 1
---test
args: 6
---test
args: 27
---solution
#!/bin/bash
n=$1; steps=0
while (( n != 1 )); do
  if (( n % 2 == 0 )); then n=$((n / 2)); else n=$((3 * n + 1)); fi
  ((steps++))
done
echo "$steps"
:::

:::exercise
id: lp-dir-report
level: 4
title: Directory report
---
For each directory directly inside your home directory (sorted, ignoring files), print a line `NAME N` where N is the number of entries inside it, formatted with `printf "%-10s %3d\n"`.
---hint
`for d in */; do d=${d%/}; …; done`. Globs come back sorted.
---solution
for d in */; do
  d=${d%/}
  printf "%-10s %3d\n" "$d" "$(ls -A "$d" | wc -l)"
done
:::

:::exercise
id: lp-prime
level: 4
title: Primes under 50
---
Print all prime numbers below 50 on one line separated by spaces (then a newline), using nested loops.
---solution
out=""
for ((n = 2; n < 50; n++)); do
  prime=1
  for ((d = 2; d * d <= n; d++)); do
    if (( n % d == 0 )); then prime=0; break; fi
  done
  (( prime )) && out="$out$n "
done
echo "${out% }"
:::
