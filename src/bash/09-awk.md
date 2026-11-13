---
id: bash-awk
title: awk: fields, patterns & reports
summary: awk's pattern { action } model, fields and NF/NR, field separators, BEGIN/END, arithmetic and aggregation, associative arrays, printf, and small programs.
minutes: 40
---
## awk in one sentence

awk reads input **line by line**, splits each line into **fields**, and for every `pattern { action }` rule whose pattern matches, runs the action. It's a whole little programming language designed for columnar text, and it's the tool to reach for once `cut | sort | uniq` gets awkward.

```bash run
awk '{ print $1 }' data/grades.txt | head -3
```

## Fields and built-in variables

| Variable | Meaning |
|---|---|
| `$0` | the whole line |
| `$1`, `$2`, … | fields 1, 2, … |
| `$NF` | the last field (NF = number of fields) |
| `$(NF-1)` | second to last |
| `NR` | current line (record) number, across all input |
| `FNR` | line number within the current file |
| `FS` | input field separator (default: runs of whitespace) |
| `OFS` | output field separator (default: a space) |
| `FILENAME` | current file name |

By default, fields are separated by **any run of spaces or tabs**, and leading whitespace is ignored. That's why awk handles `ls -l` style output that defeats `cut`.

```bash run
awk '{ print NR ": " $1 " scored " $2 }' data/grades.txt | head -3
echo "  lots   of    spacing  " | awk '{ print $2, NF }'
```

Commas in `print` insert `OFS`; juxtaposition (`$1 " " $2`) concatenates.

### Setting the separator: -F

```bash run
awk -F, '{ print $2, $4 }' data/employees.csv | head -4
awk -F'\t' '{ print $2 }' data/inventory.tsv
```

## Patterns

A pattern selects lines. Omit the action and awk prints matching lines; omit the pattern and the action runs on every line.

| Pattern | Selects |
|---|---|
| `/regex/` | lines matching the regex (ERE) |
| `$3 > 100` | a comparison |
| `$2 ~ /^db/` | field matches regex (`!~` for doesn't match) |
| `NR > 1` | skip the header |
| `NR == 5` | line 5 |
| `/start/, /stop/` | a range |
| `cond1 && cond2`, `!cond` | boolean logic |

```bash run
awk '$2 >= 90' data/grades.txt
awk -F, 'NR > 1 && $3 == "Sales" { print $2 }' data/employees.csv
awk '$3 ~ /down|maintenance/ { print $1 " needs attention" }' data/servers.txt
```

## BEGIN and END

`BEGIN { … }` runs before any input is read; `END { … }` runs after all of it. Together with variables (which start at 0 / empty, no declaration needed), they give you aggregation:

```bash run
awk '{ sum += $2 } END { print "total:", sum, "average:", sum / NR }' data/grades.txt
```

```bash run
awk -F, 'NR > 1 { if ($4 > max) { max = $4; who = $2 } } END { print who, max }' data/employees.csv
```

```bash run
awk 'BEGIN { print "Squares:"; for (i = 1; i <= 5; i++) print i, i * i }'
```

## Associative arrays: group by in awk

awk arrays are keyed by strings. `count[$3]++` counts occurrences of each value of field 3, and `for (k in arr)` loops over keys. This is GROUP BY in a few characters:

```bash run
awk -F, 'NR > 1 { n[$3]++; total[$3] += $4 }
END { for (d in n) printf "%-12s %2d people, avg %d\n", d, n[d], total[d] / n[d] }' data/employees.csv
```

> [!note] Iteration order
> `for (k in arr)` visits keys in an unspecified order in real awk implementations (this simulator uses insertion order). When order matters, pipe the output through `sort`.

## printf for formatted output

`printf` works like C's: `%s` string, `%d` integer, `%.2f` float with 2 decimals, `%-10s` left-aligned in 10 columns, `%5d` right-aligned in 5. It does **not** add a newline: include `\n`.

```bash run
awk -F, 'NR > 1 { printf "%-14s %10.2f\n", $2, $4 / 12 }' data/employees.csv | head -4
```

## Useful built-in functions

| Function | Does |
|---|---|
| `length(s)` | string length (no argument: length of `$0`) |
| `substr(s, i, n)` | substring (1-based) |
| `index(s, t)` | position of t in s |
| `split(s, arr, sep)` | split s into arr, returns count |
| `sub(re, rep, target)` / `gsub(…)` | replace first / all matches (target defaults to `$0`) |
| `match(s, re)` | sets RSTART and RLENGTH |
| `toupper(s)`, `tolower(s)` | case conversion |
| `int(x)`, `sqrt(x)` | math |
| `sprintf(fmt, …)` | format to a string |

```bash run
awk -F, 'NR > 1 { split($1, d, "-"); months[d[2]] += $4 * $5 } END { for (m in months) printf "%s %.2f\n", m, months[m] }' data/sales.csv
```

## Modifying fields

Assigning to a field rebuilds `$0` using OFS. The idiom `$1 = $1` forces a rebuild, which is a quick way to change separators:

```bash run
awk -F, -v OFS='\t' '{ $1 = $1; print }' data/employees.csv | head -3
```

`-v name=value` passes shell values into awk safely: `awk -v min="$limit" '$2 > min'`.

:::quiz
q: In awk, what is `$NF`?
- the number of fields
+ the last field on the line
- the line number
- the field separator
why: NF is the count of fields, so $NF is the field at that position: the last one.
:::

:::quiz
q: `awk 'NR > 1' file` prints…
- only line 1
+ every line except the first
- the number of lines
- nothing; there's no action
why: A pattern with no action prints matching lines; NR > 1 skips the first.
:::

:::quiz
q: Which computes the sum of column 3?
- `awk '{ print sum($3) }'`
+ `awk '{ s += $3 } END { print s }'`
- `awk 'BEGIN { s += $3 } END { print s }'`
- `awk '$3 { sum }'`
why: Accumulate on every line, print once in END. BEGIN runs before any input exists.
:::

:::quiz
q: Why does `awk '{ print $2 }'` work on `ls -l` output when `cut -d' ' -f2` doesn't?
+ awk's default separator is any run of whitespace; cut treats every single space as a separator
- awk understands ls specifically
- cut can't read from pipes
- awk ignores the first column
why: Multiple consecutive spaces make cut see empty fields; awk collapses them.
:::

:::quiz
q: `count[$1]++` followed by `END { for (k in count) print k, count[k] }` is the awk equivalent of…
- `sort -n`
+ `sort | uniq -c` (counting occurrences of field 1)
- `wc -l`
- `cut -f1`
why: An associative array keyed by $1 counts each distinct value.
:::

:::exercise
id: aw-first-col
level: 1
title: Names only
---
Print only the names (first column) of `data/grades.txt` using awk.
---solution
awk '{ print $1 }' data/grades.txt
:::

:::exercise
id: aw-swap
level: 1
title: Score first
---
Print `data/grades.txt` with the columns swapped: score, then name.
---solution
awk '{ print $2, $1 }' data/grades.txt
:::

:::exercise
id: aw-filter
level: 1
title: Failing grades
---
Print the lines of `data/grades.txt` where the score is **below 70**.
---solution
awk '$2 < 70' data/grades.txt
:::

:::exercise
id: aw-csv-fields
level: 2
title: Name and city
---
From `data/employees.csv`, print each employee's name and city separated by a space, **without** the header.
---solution
awk -F, 'NR > 1 { print $2, $6 }' data/employees.csv
:::

:::exercise
id: aw-sum
level: 2
title: Total payroll
---
Print the sum of all salaries in `data/employees.csv`.
---solution
awk -F, 'NR > 1 { s += $4 } END { print s }' data/employees.csv
:::

:::exercise
id: aw-average
level: 2
title: Class average
---
Print the average score in `data/grades.txt`, formatted with exactly 1 decimal place.
---solution
awk '{ s += $2 } END { printf "%.1f\n", s / NR }' data/grades.txt
:::

:::exercise
id: aw-last-field
level: 2
title: Status column
---
Print the **last** field of each line of `data/servers.txt`, whatever the number of fields.
---solution
awk '{ print $NF }' data/servers.txt
:::

:::exercise
id: aw-numbered
level: 2
title: Number the lines yourself
---
Print each line of `todo.txt` prefixed by its line number and a period and space, like `1. [high] fix login bug`.
---solution
awk '{ print NR ". " $0 }' todo.txt
:::

:::exercise
id: aw-revenue
level: 3
title: Revenue per sale
---
For each sale in `data/sales.csv` (skip the header), print the date, product and revenue (units × unit_price) with **2 decimals**, separated by spaces.
---solution
awk -F, 'NR > 1 { printf "%s %s %.2f\n", $1, $3, $4 * $5 }' data/sales.csv
:::

:::exercise
id: aw-group-count
level: 3
title: Employees per city
---
Count employees per city in `data/employees.csv`. Print `city count`, sorted alphabetically by city.
---hint
Count in an array, print in END, then pipe through `sort`.
---solution
awk -F, 'NR > 1 { n[$6]++ } END { for (c in n) print c, n[c] }' data/employees.csv | sort
:::

:::exercise
id: aw-group-sum
level: 3
title: Units by region
---
Total the `units` sold per `region` in `data/sales.csv`. Print `region total`, highest total first.
---solution
awk -F, 'NR > 1 { u[$2] += $4 } END { for (r in u) print r, u[r] }' data/sales.csv | sort -k2,2nr
:::

:::exercise
id: aw-max
level: 3
title: Top earner
---
Print the name and salary of the highest-paid employee in `data/employees.csv`, separated by a space.
---solution
awk -F, 'NR > 1 && $4 > max { max = $4; who = $2 } END { print who, max }' data/employees.csv
:::

:::exercise
id: aw-report
level: 4
title: Formatted department report
---
From `data/employees.csv`, print a report with one line per department, sorted by department name: the name left-aligned in 12 characters, the headcount right-aligned in 3, then the **average** salary with no decimals right-aligned in 8. Example line: `Engineering   5  100200`.
---hint
`printf "%-12s%3d%8d\n", d, n[d], t[d] / n[d]`, then `| sort`.
---solution
awk -F, 'NR > 1 { n[$3]++; t[$3] += $4 } END { for (d in n) printf "%-12s%3d%8d\n", d, n[d], t[d] / n[d] }' data/employees.csv | sort
:::

:::exercise
id: aw-bytes-per-ip
level: 4
title: Bandwidth per client
---
From `logs/access.log`, sum the response size (last field) per client IP (first field). Print `ip bytes`, largest first.
---solution
awk '{ b[$1] += $NF } END { for (ip in b) print ip, b[ip] }' logs/access.log | sort -k2,2nr
:::

:::exercise
id: aw-grade-letters
level: 4
title: Letter grades
---
Print each student in `data/grades.txt` with a letter grade: 90+ A, 80–89 B, 70–79 C, 60–69 D, below 60 F. Format: `name score letter`.
---solution
awk '{ g = $2 >= 90 ? "A" : $2 >= 80 ? "B" : $2 >= 70 ? "C" : $2 >= 60 ? "D" : "F"; print $1, $2, g }' data/grades.txt
:::

:::exercise
id: aw-inventory-value
level: 4
title: Inventory valuation
---
From the tab-separated `data/inventory.tsv` (skip the header), print the items that are **out of stock** (qty 0) as `OUT: item`, and finally a line `total value: N` where N is the sum of qty × price over all items, with 2 decimals.
---solution
awk -F'\t' 'NR > 1 { if ($3 == 0) print "OUT: " $2; v += $3 * $4 } END { printf "total value: %.2f\n", v }' data/inventory.tsv
:::
