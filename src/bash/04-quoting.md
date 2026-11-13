---
id: bash-quoting
title: Globbing, quoting & expansion
summary: Wildcards (* ? [ ]), the difference between single quotes, double quotes and backslashes, and the order in which bash expands a command line.
minutes: 30
---
> [!project] logwatch, step 4: a report header
> Reports start with a header line that mixes fixed text, variables and command output. Getting it right means understanding exactly how bash expands and splits your command line.

## Bash rewrites your line before running it

When you press Enter, bash doesn't hand your text to the command as-is. It **expands** it first, in this order:

1. **Brace expansion**: `file{1,2}` → `file1 file2`
2. **Tilde expansion**: `~` → `/home/student`
3. **Parameter & variable expansion**: `$HOME`, `${name}`
4. **Command substitution**: `$(date)`
5. **Arithmetic expansion**: `$((2 + 3))`
6. **Word splitting**: unquoted results split on whitespace into separate arguments
7. **Pathname expansion (globbing)**: `*.txt` → matching filenames
8. **Quote removal**

Quoting is how you switch some of those steps off. Understanding this list explains nearly every "why did bash do that?" moment.

## Globs (wildcards)

Globs match **filenames** that already exist. Bash expands them before the command runs; `ls` never sees the `*`.

| Pattern | Matches |
|---|---|
| `*` | any string, including empty (but not a leading `.`) |
| `?` | exactly one character |
| `[abc]` | one of a, b, c |
| `[a-z]`, `[0-9]` | one character in the range |
| `[!abc]` or `[^abc]` | one character *not* listed |

```bash run
echo photos/*.jpg
echo photos/IMG_000?.jpg
echo photos/IMG_000[1-3].jpg
echo photos/*.[pP][nN][gG]
```

`echo` with a glob is the safe way to preview what a destructive command like `rm *.log` would hit.

> [!warn] When nothing matches
> If a glob matches no files, bash leaves it **unchanged**: `ls *.xyz` passes the literal string `*.xyz` to ls, which then complains that no such file exists.

```bash run
echo *.xyz
```

> [!note] Globs are not regular expressions
> In a glob, `*` means "anything". In a regex, `*` means "zero or more of the previous thing", and `.` means any character. Glob: `*.txt`. Regex: `.*\.txt$`. Different languages, similar symbols.

## Quoting

| Syntax | What's protected | Expansions inside |
|---|---|---|
| `'single'` | everything, literally | **none** |
| `"double"` | spaces, globs, most specials | `$var`, `$(cmd)`, `$((…))`, `` `cmd` ``, `\` before `$ ` ` " \` |
| `\x` | the one next character | n/a |

```bash run
name="World"
echo 'Hello $name'
echo "Hello $name"
echo Hello \$name
```

### Why quoting variables matters

Unquoted expansions go through **word splitting** and **globbing**. That's why the golden rule of shell scripting is *quote your variables*:

```bash run
file="my report.txt"
touch "$file"
ls $file 2>&1      # unquoted: two arguments, so it fails on purpose
ls "$file"         # quoted: one argument
```

```bash run
greeting="hello      world"
echo $greeting     # splitting collapses the spaces
echo "$greeting"   # preserved
```

```bash run
pattern="*.txt"
echo $pattern      # unquoted: the glob expands!
echo "$pattern"
```

> [!exam] The rule
> Always write `"$var"` and `"$(cmd)"` unless you specifically want splitting or globbing. Unquoted variables are the #1 source of shell bugs, especially with filenames containing spaces.

## Special characters that need protecting

These mean something to the shell and must be quoted or escaped to be literal:

```
space  tab  newline  ' " \ $ ` * ? [ ] { } ( ) < > | & ; # ~ !
```

```bash run
echo "Price: \$5 & up; 100% (guaranteed)"
echo 'It'\''s a single quote inside single quotes'
echo "It's easy inside double quotes"
```

## ANSI-C quoting

`$'...'` interprets backslash escapes like `\n` and `\t`:

```bash run
echo $'col1\tcol2\nrow2'
```

## Command substitution

`$(command)` is replaced by the command's output (trailing newlines removed):

```bash run
echo "There are $(ls | wc -l) entries here, and today is $(date +%A)."
```

The older backtick form `` `cmd` `` works too but doesn't nest cleanly. Prefer `$( )`.

## Worked example: watching expansion happen

Bash rewrites your command **before** running it. You can see the rewritten words with `printf '[%s]\n'`, which prints each argument on its own line in brackets:

```bash run
printf '[%s]\n' logs/*.log
printf '[%s]\n' "logs/*.log"
printf '[%s]\n' Report for $(date +%Y) has $(ls logs | wc -l) logs
printf '[%s]\n' "Report for $(date +%Y) has $(ls logs | wc -l) logs"
```

- Unquoted `logs/*.log` became **three** arguments (glob expansion).
- Quoted, it stayed one literal string.
- Unquoted command substitution was **split** into separate words; quoted, the whole sentence is one argument.

That `printf '[%s]\n'` trick is the best debugging tool for quoting problems.

> [!plain] In plain English
> Single quotes: "take this text exactly". Double quotes: "fill in variables and `$(...)`, but keep it as one piece". No quotes: "fill in, then split on spaces and expand wildcards".

## Common mistakes

> [!mistake] Unquoted variables holding file names
> `rm $file` with `file="my report.txt"` tries to delete `my` and `report.txt`. Quote every expansion: `rm "$file"`. The rule of thumb: **always** double-quote `"$var"` and `"$(cmd)"` unless you specifically want splitting.

> [!mistake] Single quotes around a variable
> `echo 'Hello $USER'` prints `$USER` literally. Use double quotes when you want the value.

:::quiz
q: What does `echo '$HOME'` print?
+ `$HOME`
- `/home/student`
- nothing
- an error
why: Single quotes disable every expansion.
:::

:::quiz
q: `ls *.csv` is run in a directory with no CSV files. What does ls receive as its argument?
- nothing at all
+ the literal string `*.csv`
- every file in the directory
- an empty string
why: Unmatched globs are left unchanged (unless the nullglob option is set), so ls looks for a file literally named *.csv.
:::

:::quiz
q: Which matches `data1.txt` but not `data10.txt`?
- `data*.txt`
+ `data?.txt`
- `data[0-9]*.txt`
- `data.txt`
why: `?` matches exactly one character.
:::

:::quiz
q: `f="a b.txt"; rm $f` tries to remove…
- the file named `a b.txt`
+ two files, `a` and `b.txt`
- nothing; it's a syntax error
- every .txt file
why: The unquoted $f undergoes word splitting. Use `rm "$f"`.
:::

:::quiz
q: In what order does bash perform these expansions?
+ brace → variable → command substitution → word splitting → globbing
- globbing → variable → brace → word splitting
- variable → brace → globbing → word splitting
- they all happen at once
why: Brace expansion comes first; filename globbing comes last, after word splitting.
:::

:::exercise
id: qt-glob-jpg
level: 1
title: All the JPEGs
---
Use `ls` with a glob to list every `.jpg` file in `photos/`.
---solution
ls photos/*.jpg
:::

:::exercise
id: qt-single
level: 1
title: Literally a dollar
---
Print exactly this text: `Your total is $USER dollars`
---hint
Single quotes stop `$USER` from expanding.
---solution
echo 'Your total is $USER dollars'
:::

:::exercise
id: qt-double
level: 1
title: Expand inside double quotes
---
Print `Logged in as student, home is /home/student` using the `$USER` and `$HOME` variables (don't type the values).
---solution
echo "Logged in as $USER, home is $HOME"
:::

:::exercise
id: qt-question
level: 2
title: Exactly one character
---
List the files in `photos/` named `IMG_000` followed by **exactly one character** and `.jpg`, using `?`.
---solution
ls photos/IMG_000?.jpg
:::

:::exercise
id: qt-range
level: 2
title: Even-numbered images
---
Using a character class, list only `IMG_0002.jpg`, `IMG_0004.jpg` and `IMG_0006.jpg` from `photos/`.
---solution
ls photos/IMG_000[246].jpg
:::

:::exercise
id: qt-case-insensitive
level: 2
title: Any-case PNGs
---
List every file in `photos/` ending in `.png` **or** `.PNG` (any capitalization of p, n, g) using a single glob.
---solution
ls photos/*.[pP][nN][gG]
:::

:::exercise
id: qt-spaces
level: 2
title: A file with spaces
compare: verify
---
Create a file literally named `final draft.txt` (with the space) containing the line `version 2`.
---verify
ls
cat "final draft.txt"
---solution
echo "version 2" > "final draft.txt"
:::

:::exercise
id: qt-escape-mix
level: 3
title: Tricky punctuation
---
Print exactly: `She said "it's $5 & that's final!"`
---hint
Inside double quotes, escape the inner double quotes and the dollar sign with backslashes. `!` is fine in scripts.
---solution
echo "She said \"it's \$5 & that's final!\""
:::

:::exercise
id: qt-cmd-subst
level: 3
title: Self-describing output
---
Print `There are N files in data` where N is computed by counting the entries of `data/` with `ls` and `wc -l` inside a command substitution.
---solution
echo "There are $(ls data | wc -l) files in data"
:::

:::exercise
id: qt-not-glob
level: 3
title: Everything except
---
List all entries in `downloads/` whose names do **not** start with `r` or `s`.
---hint
`[!rs]*`
---solution
ls downloads/[!rs]*
:::

:::exercise
id: qt-tabs
level: 3
title: Tab-separated header
---
Print a single line containing `name`, a tab, `score`, a tab, `grade`, using `$'...'` quoting.
---solution
echo $'name\tscore\tgrade'
:::

:::exercise
id: qt-preserve-spaces
level: 4
title: Preserve the layout
---
Run this exactly, then fix the second `echo` so the output keeps the internal spacing and shows the asterisk literally instead of expanding it:

```bash
art="*   *   *"
echo $art
```

Your answer should contain the assignment and one `echo`, printing `*   *   *`.
---solution
art="*   *   *"
echo "$art"
:::

:::exercise
id: proj-bash-04-header
level: 2
title: "Project 4: the header line"
---
Print exactly this header, with the count computed by a command substitution (count the files in `logs` with `ls logs | wc -l`):

`== logwatch: 3 log files in ~/logs ==`

The `~/logs` part must appear literally, not expanded to a path.
---hint
Wrap `~/logs` so the tilde isn't expanded: inside double quotes a tilde is literal.
---solution
echo "== logwatch: $(ls logs | wc -l) log files in ~/logs =="
:::

:::exercise
id: proj-bash-04-glob
level: 2
title: "Project 4b: only the web logs"
---
List (with `ls`) only the files in `logs` whose names start with `a` or `c` and end in `.log`, using a single glob with a character class.
---solution
ls logs/[ac]*.log
:::
