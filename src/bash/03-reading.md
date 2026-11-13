---
id: bash-reading
title: Reading & inspecting files
summary: cat, head, tail, wc, nl, less and friends — looking inside files quickly, counting lines and words, and peeking at the start, end or middle.
minutes: 20
---
## cat: print whole files

`cat` (con**cat**enate) prints one or more files in order. With several files it glues them together:

```bash run
cat data/grades.txt
```

```bash run
cat -n todo.txt
```

| Flag | Effect |
|---|---|
| `-n` | number every line |
| `-b` | number non-blank lines |
| `-A` | show invisible characters (`$` at line ends, `^I` for tabs) |
| `-s` | squeeze repeated blank lines |

`cat -A` is a debugging superpower: it reveals tabs vs spaces and Windows line endings (`^M$`).

```bash run
cat -A data/inventory.tsv | head -3
```

## head and tail

`head` shows the first 10 lines, `tail` the last 10. `-n N` changes the count.

```bash run
head -n 3 logs/access.log
```

```bash run
tail -n 2 data/employees.csv
```

Two forms worth memorizing:

| Command | Meaning |
|---|---|
| `head -n -2 file` | everything **except** the last 2 lines |
| `tail -n +2 file` | everything **from line 2 on** (skip a header line) |
| `head -n 20 file \| tail -n 5` | lines 16–20 (a slice from the middle) |
| `tail -f file` | keep printing new lines as a log grows (real terminals) |

```bash run
tail -n +2 data/employees.csv | head -n 3
```

## wc: count lines, words, characters

```bash run
wc data/grades.txt
wc -l logs/*.log
```

`wc` prints lines, words, bytes, then the filename. Use `-l`, `-w`, `-c` for just one count. Feed it with `<` (or a pipe) to get the bare number without a filename, which is what you want inside scripts:

```bash run
wc -l < data/grades.txt
```

> [!exam] Lines = newline characters
> `wc -l` counts newline characters. A file whose last line has no trailing newline reports one fewer line than you'd expect.

## Other viewers

| Command | Use |
|---|---|
| `less file` | scroll through big files (`q` quits, `/word` searches, `G` jumps to end) |
| `nl file` | number non-empty lines |
| `tac file` | print lines in reverse order |
| `rev` | reverse the characters of each line |
| `file name` | guess the file type |
| `du -h dir` | disk usage |
| `stat file` | size, permissions, timestamps |

```bash run
tac data/grades.txt | head -3
```

```bash run
du -h data
```

## Combining files

`cat a b > c` writes the concatenation of `a` and `b` into `c`. You'll see much more of `>` in the redirection lesson.

```bash run
cat data/grades.txt data/words.txt | wc -l
```

:::quiz
q: Which prints everything except the first line of `data.csv`?
- `head -n 1 data.csv`
- `tail -n 1 data.csv`
+ `tail -n +2 data.csv`
- `head -n -1 data.csv`
why: `tail -n +2` starts output at line 2. `head -n -1` drops the *last* line.
:::

:::quiz
q: What does `wc -l < notes.txt` print?
+ just the number of lines
- the number of lines followed by the filename
- the number of words
- the first line
why: When reading from stdin, wc doesn't know a filename, so it prints only the count.
:::

:::quiz
q: How do you show lines 11–20 of a file?
- `head -n 20 file | head -n 10`
+ `head -n 20 file | tail -n 10`
- `tail -n 20 file | head -n 10`
- `head -n 11-20 file`
why: Take the first 20, then the last 10 of those.
:::

:::quiz
q: You suspect a file has tab characters where you expected spaces. Which command shows them?
- `cat -n`
+ `cat -A`
- `wc -c`
- `head -t`
why: cat -A displays tabs as ^I and line ends as $.
:::

:::exercise
id: rd-cat
level: 1
title: Read the todo list
---
Print the contents of `todo.txt`.
---solution
cat todo.txt
:::

:::exercise
id: rd-head5
level: 1
title: First five log lines
---
Show the first 5 lines of `logs/app.log`.
---solution
head -n 5 logs/app.log
:::

:::exercise
id: rd-last-line
level: 1
title: The last employee
---
Show only the last line of `data/employees.csv`.
---solution
tail -n 1 data/employees.csv
:::

:::exercise
id: rd-count-lines
level: 1
title: How long is the log?
---
Print **only the number** of lines in `logs/access.log` (no filename).
---solution
wc -l < logs/access.log
:::

:::exercise
id: rd-numbered
level: 2
title: Number the notes
---
Print `notes.txt` with line numbers.
---solution
cat -n notes.txt
:::

:::exercise
id: rd-skip-header
level: 2
title: Data without the header
---
Print `data/sales.csv` **without** its header row.
---solution
tail -n +2 data/sales.csv
:::

:::exercise
id: rd-middle
level: 2
title: A slice from the middle
---
Print lines **6 through 8** of `data/words.txt`.
---hint
`head` to cut off the bottom, then `tail` to cut off the top.
---solution
head -n 8 data/words.txt | tail -n 3
:::

:::exercise
id: rd-word-count
level: 2
title: Words in the notes
---
Print just the number of **words** in `notes.txt`.
---solution
wc -w < notes.txt
:::

:::exercise
id: rd-multi-count
level: 3
title: Count every log
---
Show the line counts of **all** `.log` files in `logs/`, including the total line.
---solution
wc -l logs/*.log
:::

:::exercise
id: rd-reverse
level: 3
title: Bottom-up grades
---
Print the last three lines of `data/grades.txt` in **reverse** order (last line first).
---solution
tail -n 3 data/grades.txt | tac
:::

:::exercise
id: rd-records
level: 3
title: Count records, not lines
---
Print the number of **data rows** in `data/employees.csv` (lines minus the header), as a bare number.
---solution
tail -n +2 data/employees.csv | wc -l
:::

:::exercise
id: rd-all-but-last
level: 4
title: Everything but the ends
---
Print `data/grades.txt` without its **first two** and **last two** lines.
---hint
`tail -n +3` removes the top; `head -n -2` removes the bottom.
---solution
tail -n +3 data/grades.txt | head -n -2
:::
