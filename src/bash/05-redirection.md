---
id: bash-redirect
title: Redirection & pipes
summary: stdin, stdout and stderr; >, >>, <, 2>, 2>&1 and /dev/null; pipes that chain programs; tee; heredocs, here-strings and process substitution.
minutes: 30
---
> [!project] logwatch, step 5: saving reports
> Results on screen disappear. In this lesson logwatch starts writing **report files**, appending sections, and keeping error messages separate from data.

## Three standard streams

Every process starts with three open streams:

| Stream | Number | Default | Typical use |
|---|---|---|---|
| **stdin** | 0 | keyboard | input data |
| **stdout** | 1 | terminal | normal output |
| **stderr** | 2 | terminal | errors and diagnostics |

Both stdout and stderr show up on your screen, which hides the fact that they're separate. Redirection makes the difference visible.

## Output redirection

| Syntax | Effect |
|---|---|
| `cmd > file` | stdout to file (**truncates**: replaces the contents) |
| `cmd >> file` | stdout appended to file |
| `cmd 2> file` | stderr to file |
| `cmd > out 2> err` | split the two streams |
| `cmd > file 2>&1` | both streams to the same file |
| `cmd &> file` | both streams (bash shorthand) |
| `cmd > /dev/null` | discard output |

```bash run
echo "first" > log.txt
echo "second" >> log.txt
cat log.txt
```

```bash run
ls notes.txt missing.txt > out.txt 2> err.txt
echo "--- out.txt:"; cat out.txt
echo "--- err.txt:"; cat err.txt
```

> [!warn] `>` destroys first
> The shell truncates the target file *before* the command runs. So `sort data.txt > data.txt` leaves you with an **empty file**: by the time sort reads it, it's already gone. Write to a temporary file, then `mv` it over.

### Order matters with 2>&1

`2>&1` means "make stderr point wherever stdout points **right now**". Redirections are processed left to right:

```bash
cmd > file 2>&1    # stdout → file, then stderr → (same as stdout) file      ✓ both in file
cmd 2>&1 > file    # stderr → terminal (stdout's current target), then stdout → file
```

```bash run
ls nope 2>&1 > out.txt
echo "file has: $(cat out.txt)"
```

The error appeared on screen, not in the file.

## Input redirection

`cmd < file` feeds the file to the command's stdin:

```bash run
sort < data/words.txt | head -3
wc -l < todo.txt
```

## Pipes

A **pipe** `|` connects one command's stdout to the next command's stdin. This is the heart of the Unix philosophy: small tools that each do one thing, combined into pipelines.

```bash run
cat data/words.txt | sort | uniq -c | sort -rn | head -3
```

Read it left to right: list the words, sort them so duplicates are adjacent, count each run, sort by count descending, take the top three.

> [!tip] Build pipelines one stage at a time
> Run the first command alone, look at the output, add `| next`, look again. Debugging a 6-stage pipeline all at once is miserable; building it incrementally is easy.

Pipes carry only stdout. To send errors through a pipe too, use `2>&1 |` (or `|&` in bash).

```bash run
ls notes.txt nope 2>&1 | wc -l
```

## tee: save and pass along

`tee file` copies its stdin to a file **and** to stdout, like a T-junction in plumbing:

```bash run
grep ERROR logs/app.log | tee errors.txt | wc -l
echo "saved:"; head -2 errors.txt
```

`tee -a` appends instead of overwriting.

## Here documents and here strings

A **heredoc** feeds multiple lines of text to a command's stdin:

```bash run
cat <<EOF > greeting.txt
Dear $USER,
Your home is $HOME.
EOF
cat greeting.txt
```

Quote the delimiter (`<<'EOF'`) to turn off variable expansion inside. `<<-EOF` strips leading tabs so you can indent the heredoc in scripts.

A **here string** `<<<` feeds a single string:

```bash run
wc -w <<< "how many words are here"
tr a-z A-Z <<< "shout"
bc <<< "2 + 3 * 4"
```

`bc` is a calculator that reads arithmetic from its input and prints the result; here strings are a handy way to feed it.

## Process substitution

`<(cmd)` turns a command's output into something that looks like a file. Perfect for tools that want filenames, like `diff` or `comm`:

```bash run
diff <(head -3 data/words.txt) <(tail -3 data/words.txt)
```

`diff A B` compares two files line by line and prints only the differences: lines starting with `<` are in A only, lines starting with `>` are in B only.

## Exit status travels separately

Every command returns an exit status: `0` for success, non-zero for failure. `$?` holds the last one. In a pipeline, `$?` is the status of the **last** command (unless `set -o pipefail`).

`grep -q` is grep's **quiet** mode: it prints nothing and only reports, through its exit status, whether anything matched.

```bash run
grep -q ERROR logs/app.log; echo "status: $?"
grep -q KITTENS logs/app.log; echo "status: $?"
```

## Worked example: building a report file section by section

```bash run
mkdir -p reports
echo "== errors ==" > reports/daily.txt
grep ERROR logs/app.log >> reports/daily.txt
echo "== warnings ==" >> reports/daily.txt
grep -c WARN logs/app.log >> reports/daily.txt
cat reports/daily.txt
```

The first line uses `>` to **start a fresh file**; every later line uses `>>` to **append**. Mixing them up is the classic way to end up with a report that only contains its last section.

A cleaner way to write several lines at once is a **group**: redirect the output of the whole block once:

```bash run
mkdir -p reports
{
  echo "== errors =="
  grep ERROR logs/app.log
  echo "== warning count =="
  grep -c WARN logs/app.log
} > reports/daily.txt
wc -l reports/daily.txt
```

## Separating errors from data

Programs write results to **stdout** (1) and problems to **stderr** (2). Keep them apart so your report stays clean:

```bash run
mkdir -p reports
grep ERROR logs/app.log logs/missing.log > reports/found.txt 2> reports/problems.txt
cat reports/problems.txt
```

> [!plain] In plain English
> `>` sends output into a file, `|` sends it into another command, `2>` handles error messages. They compose: `cmd 2>/dev/null | sort > out.txt`.

## Common mistakes

> [!mistake] Reading and writing the same file
> `sort data.txt > data.txt` empties the file **before** `sort` reads it, so you lose everything. Write to a temporary file and `mv` it, or use `sort -o data.txt data.txt`.

> [!mistake] Order of `2>&1`
> `cmd > out.txt 2>&1` sends both streams to the file. `cmd 2>&1 > out.txt` sends stderr to the **terminal**, because redirections are processed left to right.

:::quiz
q: What does `cmd >> log.txt` do?
- Overwrites log.txt with cmd's output
+ Appends cmd's stdout to log.txt
- Appends both stdout and stderr
- Reads log.txt as input
why: `>>` appends; `>` truncates.
:::

:::quiz
q: Which sends both stdout and stderr to `all.txt`?
+ `cmd > all.txt 2>&1`
- `cmd 2>&1 > all.txt`
- `cmd 2> all.txt`
- `cmd | all.txt`
why: Redirect stdout first, then point stderr at the same place. The reverse order leaves stderr on the terminal.
:::

:::quiz
q: After `sort names.txt > names.txt`, the file contains…
- the sorted names
- the original names
+ nothing
- an error message
why: The shell truncates names.txt before sort starts reading it.
:::

:::quiz
q: A pipe `a | b` connects…
+ a's stdout to b's stdin
- a's stderr to b's stdin
- a's stdout to b's arguments
- b's output back to a
why: Pipes connect stdout to stdin. Use xargs to turn input into arguments.
:::

:::quiz
q: `cmd 2>/dev/null` …
- deletes the command's output file
+ discards error messages and keeps normal output
- discards normal output and keeps errors
- runs cmd silently in the background
why: /dev/null is a sink that throws away whatever is written to it; 2> redirects only stderr.
:::

:::exercise
id: io-save-listing
level: 1
title: Save a listing
compare: verify
---
Save the output of `ls data` into a file called `listing.txt`.
---verify
cat listing.txt
---solution
ls data > listing.txt
:::

:::exercise
id: io-append
level: 1
title: Append a task
compare: verify
---
Add the line `[low] water the plants` to the **end** of `todo.txt` without removing anything.
---verify
tail -n 3 todo.txt
wc -l < todo.txt
---solution
echo "[low] water the plants" >> todo.txt
:::

:::exercise
id: io-count-pipe
level: 1
title: Count with a pipe
---
Print how many entries `ls photos` lists, using a pipe into `wc -l`.
---solution
ls photos | wc -l
:::

:::exercise
id: io-silence-errors
level: 2
title: Silence the noise
---
Run `ls notes.txt ghost.txt todo.txt` so that the error about `ghost.txt` is **discarded** but the other output still prints.
---solution
ls notes.txt ghost.txt todo.txt 2>/dev/null
:::

:::exercise
id: io-split-streams
level: 2
title: Separate the streams
compare: verify
---
Run `cat todo.txt nothing.txt` sending normal output to `ok.txt` and error messages to `bad.txt`.
---verify
echo "ok: $(wc -l < ok.txt) lines"
cat bad.txt
---solution
cat todo.txt nothing.txt > ok.txt 2> bad.txt
:::

:::exercise
id: io-both-one-file
level: 2
title: Everything in one log
compare: verify
---
Run `ls data nowhere` and capture **both** its output and its error in `run.log`.
---verify
cat run.log
---solution
ls data nowhere > run.log 2>&1
:::

:::exercise
id: io-heredoc
level: 2
title: Write a file with a heredoc
compare: verify
---
Using a heredoc, create `contact.txt` containing exactly these three lines (with your actual username from `$USER` on the first line):

```
Name: student
Course: CSC 230
Section: 001
```
---verify
cat contact.txt
---solution
cat <<EOF > contact.txt
Name: $USER
Course: CSC 230
Section: 001
EOF
:::

:::exercise
id: io-tee
level: 3
title: Save and count
---
Find lines containing `WARN` in `logs/app.log`; save them to `warnings.txt` **and**, in the same pipeline, print how many there are.
---solution
grep WARN logs/app.log | tee warnings.txt | wc -l
:::

:::exercise
id: io-here-string
level: 3
title: Here-string math
---
Use a here string to send the text `3 + 4 * 5` to `bc` and print the result.
---solution
bc <<< "3 + 4 * 5"
:::

:::exercise
id: io-safe-sort
level: 3
title: Sort a file in place, safely
compare: verify
---
Sort `data/words.txt` alphabetically and replace the file with the sorted version **without** losing its contents.
---hint
Write to a temporary file, then mv it over the original. (Or use `sort -o`.)
---verify
cat data/words.txt
---solution
sort data/words.txt > /tmp/words.sorted && mv /tmp/words.sorted data/words.txt
:::

:::exercise
id: io-diff-procsub
level: 4
title: What changed?
---
Using process substitution, `diff` the **sorted unique** words in `data/words.txt` against the sorted unique words in this here-string list: `apple banana kiwi plum` (one word per line). Hint: `tr ' ' '\n'` turns spaces into newlines.
---hint
`diff <(sort -u data/words.txt) <(tr ' ' '\n' <<< "apple banana kiwi plum" | sort -u)`
---solution
diff <(sort -u data/words.txt) <(tr ' ' '\n' <<< "apple banana kiwi plum" | sort -u)
:::

:::exercise
id: io-pipeline-top
level: 4
title: Most common word
---
Print the word that appears **most often** in `data/words.txt`, along with its count, as `uniq -c` prints it (e.g. `      3 apple`). Build it from the pipeline in the "Pipes" section.
---hint
Sort so equal words are adjacent, count them with `uniq -c`, sort by the count descending (`sort -rn`), then keep one line.
---solution
sort data/words.txt | uniq -c | sort -rn | head -n 1
:::

:::exercise
id: proj-bash-05-report
level: 2
title: "Project 5: the error report"
compare: verify
path: ops/commands/05-report.sh
---
Create `reports/errors.txt` (make the `reports` folder first) containing a first line `ERRORS`, followed by every line of `logs/app.log` that contains `ERROR`. Then **append** a line `WARNINGS` followed by every line containing `WARN`.
---verify
cat reports/errors.txt
---solution
mkdir -p reports
echo "ERRORS" > reports/errors.txt
grep ERROR logs/app.log >> reports/errors.txt
echo "WARNINGS" >> reports/errors.txt
grep WARN logs/app.log >> reports/errors.txt
:::

:::exercise
id: proj-bash-05-tee
level: 2
title: "Project 5b: show and save"
compare: verify
path: ops/commands/05-tee.sh
---
Count the lines in `logs/access.log` that contain `404`, showing the count on screen **and** saving it to `reports/404-count.txt` in one pipeline (create `reports` first).
---verify
cat reports/404-count.txt
---solution
mkdir -p reports
grep -c 404 logs/access.log | tee reports/404-count.txt
:::
