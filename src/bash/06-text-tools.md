---
id: bash-text
title: The text-processing toolkit
summary: sort, uniq, cut, tr, paste, column and friends — the small tools that, piped together, answer real questions about data files.
minutes: 35
---
> [!project] logwatch, step 6: who's hitting the server?
> The first real question for any web log: **which clients send the most requests?** It's a four-command pipeline you'll use for the rest of your career.

## Text is the universal interface

Most Unix tools read lines of text and write lines of text. Learn a dozen of them well and you can answer surprisingly complex questions about logs and data files without writing a program.

## sort

| Flag | Meaning |
|---|---|
| `-n` | numeric sort (so 10 comes after 9) |
| `-r` | reverse |
| `-u` | unique: drop duplicate lines |
| `-t ','` | field separator (default: whitespace) |
| `-k 2` | sort by field 2 **through the end of the line** |
| `-k 2,2` | sort by field 2 **only** |
| `-k 2,2n` | field 2 numerically; flags can attach to a key |
| `-f` | ignore case |
| `-h` | human sizes (2K < 1M) |

```bash run
sort -k2 -n data/grades.txt | head -3
```

```bash run
sort -t, -k4,4nr data/employees.csv | head -3
```

> [!warn] Text vs numeric sorting
> Without `-n`, sort compares character by character: `"100" < "9"` because `"1" < "9"`. If a sorted column of numbers looks scrambled, you forgot `-n`.

Multiple keys: sort by department, then by salary descending within it:

```bash run
tail -n +2 data/employees.csv | sort -t, -k3,3 -k4,4nr | head -6
```

## uniq

`uniq` collapses **adjacent** duplicate lines, so it's almost always preceded by `sort`.

| Flag | Meaning |
|---|---|
| `-c` | prefix each line with its count |
| `-d` | only print lines that were duplicated |
| `-u` | only print lines that were unique |
| `-i` | ignore case |

```bash run
sort data/words.txt | uniq -c
```

The **frequency-count idiom** is worth memorizing:

```bash
... | sort | uniq -c | sort -rn | head
```

```bash run
cut -d, -f3 data/employees.csv | tail -n +2 | sort | uniq -c | sort -rn
```

## cut

`cut` extracts columns.

| Usage | Extracts |
|---|---|
| `cut -d, -f2` | field 2 of comma-separated lines |
| `cut -d, -f1,3` | fields 1 and 3 |
| `cut -d, -f2-4` | fields 2 through 4 |
| `cut -f2` | field 2 of **tab**-separated lines (tab is the default) |
| `cut -c1-5` | characters 1 to 5 |

```bash run
cut -d, -f2,4 data/employees.csv | head -4
```

```bash run
cut -f2,3 data/inventory.tsv
```

> [!tip] cut's limitation
> `cut` splits on **exactly one** delimiter character. Columns separated by runs of spaces (like `ls -l` output) confuse it. Use `awk '{print $2}'` there, or squeeze the spaces first with `tr -s ' '`.

## tr

`tr` translates or deletes **characters** (it only reads stdin; no filename argument).

```bash run
echo "Hello, World" | tr 'a-z' 'A-Z'
echo "Hello, World" | tr -d ',lo'
echo "too    many     spaces" | tr -s ' '
echo "a,b,c" | tr ',' '\n'
echo "Phone: (919) 555-0142" | tr -cd '0-9'; echo
```

| Flag | Meaning |
|---|---|
| `tr SET1 SET2` | replace each char of SET1 with the matching char of SET2 |
| `-d SET` | delete characters in SET |
| `-s SET` | squeeze runs of repeated characters into one |
| `-c` | complement SET1 (everything *not* in it) |

Character classes work too: `[:upper:]`, `[:lower:]`, `[:digit:]`, `[:space:]`, `[:alpha:]`, `[:punct:]`.

## Word frequency: putting it together

The classic pipeline: split text into one word per line, normalize case, count.

```bash run
cat notes.txt | tr -cs '[:alpha:]' '\n' | tr '[:upper:]' '[:lower:]' | sort | uniq -c | sort -rn | head -5
```

`tr -cs '[:alpha:]' '\n'` replaces every run of non-letters with a single newline, turning prose into one word per line.

## paste and column

`paste` joins files **side by side**, line by line. `paste -s` joins all lines of one file into one line. `-d` sets the delimiter.

```bash run
paste -d: <(cut -d' ' -f1 data/grades.txt) <(cut -d' ' -f2 data/grades.txt) | head -3
seq 5 | paste -sd+
seq 5 | paste -sd+ | bc
```

`column -t` aligns whitespace-separated (or `-s`-separated) text into a table:

```bash run
head -5 data/employees.csv | column -t -s,
```

## Other handy tools

| Command | Does |
|---|---|
| `nl` | number lines |
| `rev` | reverse each line's characters |
| `comm a b` | compare two **sorted** files: lines only in a, only in b, in both |
| `seq 1 10` | print a number sequence |
| `shuf` | shuffle lines (not available in this simulator) |

## Worked example: the "top N" pipeline, one stage at a time

Build pipelines left to right and look at the output after **each** stage:

```bash run
cut -d' ' -f1 logs/access.log | head -5
```

Stage 1 extracts field 1 (the IP), with fields separated by spaces.

```bash run
cut -d' ' -f1 logs/access.log | sort | head -5
```

Stage 2 sorts, so identical IPs sit next to each other. `uniq` only collapses **adjacent** duplicates, which is why sorting first matters.

```bash run
cut -d' ' -f1 logs/access.log | sort | uniq -c
```

Stage 3 counts each run of identical lines.

```bash run
cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -rn | head -3
```

Stage 4 sorts by that count, **n**umerically and **r**everse (biggest first), and keeps the top 3.

The pattern `… | sort | uniq -c | sort -rn | head` answers any "most common X" question: most requested paths, most frequent error messages, busiest hours.

> [!plain] In plain English
> Each command does one small job and passes its output to the next through `|`. Long, powerful pipelines are just small, boring steps chained together.

## Common mistakes

> [!mistake] `sort` without `-n` on numbers
> Text sorting puts `10` before `9` (it compares character by character). Use `sort -n` for numbers, `sort -rn` for biggest first, and `sort -k2,2n` to sort numerically by column 2.

> [!mistake] `cut` on multiple spaces
> `cut -d' '` treats every single space as a separator, so two spaces in a row create an empty field. The app log has two spaces after `INFO`. For whitespace-aligned text, `awk '{print $3}'` is more robust.

:::quiz
q: Why does `sort | uniq` appear together so often?
- uniq is faster after sort
+ uniq only removes *adjacent* duplicates, so the input must be sorted first
- sort can't remove duplicates
- uniq requires numeric input
why: uniq compares each line to the previous one only. (sort -u alone also works when you don't need counts.)
:::

:::quiz
q: `sort -t, -k2 file` sorts by…
- field 2 only
+ field 2 through the end of the line
- the second character
- column 2 of tab-separated input
why: -k2 starts the key at field 2 and runs to the end. Use -k2,2 to sort on field 2 alone.
:::

:::quiz
q: Which turns `a b c` into three lines?
+ `tr ' ' '\n'`
- `tr '\n' ' '`
- `cut -d' ' -f1-3`
- `sort -n`
why: tr replaces each space character with a newline.
:::

:::quiz
q: Without `-n`, how does sort order the lines 9, 10, 100?
- 9, 10, 100
+ 10, 100, 9
- 100, 10, 9
- 9, 100, 10
why: Text comparison looks at the first character: '1' < '9'.
:::

:::quiz
q: `cut -d' ' -f2` on the line `a    b` (four spaces) prints…
- b
+ an empty string
- a
- the whole line
why: Each space is a delimiter, so field 2 is the empty string between the first and second spaces. Squeeze with `tr -s ' '` or use awk.
:::

:::exercise
id: tx-sort-words
level: 1
title: Alphabetize
---
Print the words in `data/words.txt` in alphabetical order (duplicates included).
---solution
sort data/words.txt
:::

:::exercise
id: tx-unique-words
level: 1
title: Unique words
---
Print each distinct word in `data/words.txt` once, alphabetically.
---solution
sort -u data/words.txt
:::

:::exercise
id: tx-upper
level: 1
title: Shout the todo list
---
Print `todo.txt` with every lowercase letter converted to uppercase.
---solution
tr 'a-z' 'A-Z' < todo.txt
:::

:::exercise
id: tx-cut-names
level: 2
title: Just the names
---
Print only the `name` column of `data/employees.csv`, **without** the header line.
---solution
tail -n +2 data/employees.csv | cut -d, -f2
:::

:::exercise
id: tx-top-scores
level: 2
title: Top three scores
---
Print the three lines of `data/grades.txt` with the **highest** scores, highest first.
---solution
sort -k2,2nr data/grades.txt | head -n 3
:::

:::exercise
id: tx-dupes
level: 2
title: Which words repeat?
---
Print (once each, alphabetically) the words that appear **more than once** in `data/words.txt`.
---solution
sort data/words.txt | uniq -d
:::

:::exercise
id: tx-word-counts
level: 2
title: Word frequencies
---
Count how many times each word appears in `data/words.txt`. Show the most frequent first; for equal counts, alphabetical order.
---hint
`sort | uniq -c`, then sort the counts numerically in reverse. For the tie-break, sort by count descending with `-k1,1nr` and then by word with `-k2,2`.
---solution
sort data/words.txt | uniq -c | sort -k1,1nr -k2,2
:::

:::exercise
id: tx-cities
level: 2
title: Distinct cities
---
List each distinct `city` from `data/employees.csv` (last column), no header, alphabetically.
---solution
tail -n +2 data/employees.csv | cut -d, -f6 | sort -u
:::

:::exercise
id: tx-salary-sort
level: 3
title: Payroll by department
---
Print `data/employees.csv` rows (no header) sorted by `department` alphabetically, and within each department by `salary` from highest to lowest.
---solution
tail -n +2 data/employees.csv | sort -t, -k3,3 -k4,4nr
:::

:::exercise
id: tx-dept-counts
level: 3
title: Headcount by department
---
Print the number of employees per department in `data/employees.csv`, formatted as produced by `uniq -c`, largest department first (ties alphabetical).
---solution
tail -n +2 data/employees.csv | cut -d, -f3 | sort | uniq -c | sort -k1,1nr -k2,2
:::

:::exercise
id: tx-digits-only
level: 3
title: Strip a phone number
---
For each line of `data/contacts.txt`, print only the digits of the **phone number** (third comma-separated field), one per line. E.g. `(919) 555-0142` → `9195550142`.
---hint
`cut -d, -f3` gets the phone; `tr -cd '0-9\n'` deletes everything except digits and newlines.
---solution
cut -d, -f3 data/contacts.txt | tr -cd '0-9\n'
:::

:::exercise
id: tx-sum-units
level: 3
title: Total units sold
---
Print the **sum** of the `units` column (4th field) of `data/sales.csv` using `cut`, `paste -sd+` and `bc`.
---solution
tail -n +2 data/sales.csv | cut -d, -f4 | paste -sd+ | bc
:::

:::exercise
id: tx-word-freq
level: 4
title: Top words in the notes
---
Find the five most common words in `notes.txt`, case-insensitively (`The` and `the` are the same word). Words are runs of letters. Print as `uniq -c` would (count then word), most common first, ties broken alphabetically.
---hint
`tr -cs '[:alpha:]' '\n'` splits into words; `tr '[:upper:]' '[:lower:]'` normalizes case. Watch out for an empty line at the start.
---solution
tr -cs '[:alpha:]' '\n' < notes.txt | tr '[:upper:]' '[:lower:]' | grep -v '^$' | sort | uniq -c | sort -k1,1nr -k2,2 | head -n 5
:::

:::exercise
id: tx-status-codes
level: 4
title: HTTP status breakdown
---
From `logs/access.log`, count requests per HTTP **status code** (the 9th space-separated field). Print `uniq -c` style, most common first, ties by code.
---hint
In this log, fields are separated by single spaces, so `cut -d' ' -f9` works.
---solution
cut -d' ' -f9 logs/access.log | sort | uniq -c | sort -k1,1nr -k2,2n
:::

:::exercise
id: tx-comm
level: 4
title: Words only in one list
---
Print the words that appear in `data/words.txt` but **not** in this list: `apple`, `fig`, `kiwi`, `zucchini`. Each word once, alphabetically. Use `comm`.
---hint
`comm -23 A B` prints lines only in A. Both inputs must be sorted; use process substitution for the second list.
---solution
comm -23 <(sort -u data/words.txt) <(printf '%s\n' apple fig kiwi zucchini | sort)
:::

:::exercise
id: proj-bash-06-top-ips
level: 2
title: "Project 6: top 3 clients"
---
Print the 3 IP addresses that made the most requests in `logs/access.log`, with their counts (as `uniq -c` prints them), busiest first.
---solution
cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -rn | head -3
:::

:::exercise
id: proj-bash-06-paths
level: 3
title: "Project 6b: most requested pages"
---
Print the 5 most requested **paths** (field 7 of `access.log`) with their counts, most requested first. Several paths have the same count, so make the order deterministic: sort ties alphabetically by path (`sort -k1,1rn -k2`).
---hint
`cut -d' ' -f7`, then the top-N pipeline, with the final sort as `sort -k1,1rn -k2`.
---solution
cut -d' ' -f7 logs/access.log | sort | uniq -c | sort -k1,1rn -k2 | head -5
:::
