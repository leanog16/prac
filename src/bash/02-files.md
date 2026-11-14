---
id: bash-files
title: Files & directories
summary: Creating, copying, moving, renaming and deleting files and directories — mkdir -p, touch, cp -r, mv, rm -r — plus brace expansion for building structures fast.
minutes: 25
---
> [!project] logwatch, step 2: a home for the project
> Every project needs a layout. In this lesson you'll create logwatch's folders, keep a working copy of the logs so experiments can't damage the originals, and tidy up as you go.

## Creating things

| Command | Does |
|---|---|
| `mkdir dir` | make a directory |
| `mkdir -p a/b/c` | make the whole path, no error if it exists |
| `touch file` | create an empty file (or update its timestamp) |
| `echo text > file` | create a file with content (redirection, covered soon) |

```bash run
mkdir reports
touch reports/q1.txt reports/q2.txt
ls reports
```

Without `-p`, `mkdir` refuses to create nested paths whose parents don't exist:

```bash run
mkdir deep/nested/dir 2>&1   # fails on purpose
mkdir -p deep/nested/dir     # works
tree deep
```

## Brace expansion

Bash expands `{a,b,c}` into separate words *before* running the command. It's not a filename match (the names don't have to exist), so it's perfect for creating structures:

```bash run
echo file{A,B,C}.txt
echo {1..5}
echo {01..10..3}
echo {a..e}
```

```bash run
mkdir -p project/{src,tests,docs}
touch project/src/{main,util}.py project/tests/test_{main,util}.py
tree project
```

> [!tip] Braces nest and combine
> `mkdir -p app/{frontend/{css,js},backend}` creates the parent directories and the three leaf directories `frontend/css`, `frontend/js` and `backend`. `cp config.ini{,.bak}` expands to `cp config.ini config.ini.bak`: a quick backup.

## Copying: cp

```bash
cp source dest            # copy a file (dest can be a new name or a directory)
cp a b c destdir/         # copy several files into a directory
cp -r srcdir destdir      # copy a directory recursively
cp -i ...                 # ask before overwriting
cp -n ...                 # never overwrite
```

```bash run
cp todo.txt todo-backup.txt
cp -r scripts scripts-old
ls
```

Without `-r`, `cp` skips directories with an "omitting directory" message.

## Moving and renaming: mv

There's no separate rename command: renaming *is* moving within the same directory.

```bash run
mv todo.txt tasks.txt          # rename
mkdir -p old
mv notes.txt tasks.txt old/    # move several files into a directory
ls old
```

> [!warn] No undo, no trash
> `mv` and `cp` silently overwrite an existing destination file. `rm` deletes immediately; there's no recycle bin. Use `-i` (interactive) when it matters.

## Deleting: rm and rmdir

| Command | Removes |
|---|---|
| `rm file` | a file |
| `rm -r dir` | a directory and everything inside |
| `rm -f file` | without complaining if it doesn't exist |
| `rmdir dir` | an **empty** directory only |

```bash run
rm -r downloads
rmdir archive        # empty, so this works
ls
```

The infamous `rm -rf /` deletes everything. This practice shell refuses to remove `/` or your home directory, but real systems are less forgiving. Double-check any `rm -rf` with a variable in it: `rm -rf "$dir/"` with an empty `$dir` means `rm -rf /`.

## Checking what you made

- `ls -R` or `tree` to view a structure
- `find dir` to list every path (one per line, great for piping)
- `file name` to guess a file's type

```bash run
file notes.txt scripts/backup.sh photos/IMG_0001.jpg data
```

## Worked example: scaffolding a project

A typical small tool looks like this:

```
logwatch/
├── bin/        scripts you run
├── reports/    generated output
└── samples/    copies of input data to experiment on
```

Brace expansion builds it in one command, and `-p` creates parents and doesn't complain if a folder already exists:

```bash run
mkdir -p logwatch/{bin,reports,samples}
cp logs/*.log logwatch/samples/
tree logwatch
```

Notice `cp logs/*.log logwatch/samples/`: the trailing `/` makes it obvious the destination is a directory. If `samples` didn't exist, `cp` with several sources would fail instead of silently creating a file.

> [!plain] In plain English
> `mkdir` makes folders, `cp` copies, `mv` moves **or renames** (same command), `rm` deletes. There's no recycle bin: `rm` is permanent.

## Safer habits

- Use `cp -i`, `mv -i`, `rm -i` when unsure: they ask before overwriting or deleting.
- Before `rm -r something`, run `ls something` first and read what you're about to delete.
- Work on **copies** of important data (like we just did with the logs).

## Common mistakes

> [!mistake] `rm -rf` with a variable that's empty
> In scripts, `rm -rf "$DIR/"` with `DIR` unset becomes `rm -rf /`. Always quote, check variables are set (`${DIR:?}`), and prefer specific paths.

> [!mistake] `mv` onto an existing file
> `mv draft.txt report.txt` silently replaces `report.txt` if it exists. Use `-i` or `-n` (no-clobber).

:::quiz
q: `mkdir a/b/c` fails because `a` doesn't exist. What fixes it?
- `mkdir -r a/b/c`
+ `mkdir -p a/b/c`
- `mkdir -f a/b/c`
- `touch a/b/c`
why: -p creates missing parents (and doesn't complain if the directory already exists).
:::

:::quiz
q: What does `echo log{1..3}.txt` print?
+ `log1.txt log2.txt log3.txt`
- `log{1..3}.txt`
- `log1..3.txt`
- the names of existing files matching log*.txt
why: Brace expansion generates words regardless of whether files exist.
:::

:::quiz
q: How do you rename `draft.txt` to `final.txt`?
- `rename draft.txt final.txt`
- `cp -m draft.txt final.txt`
+ `mv draft.txt final.txt`
- `ren draft.txt final.txt`
why: mv moves; moving to a new name in the same directory is a rename.
:::

:::quiz
q: `rmdir photos` fails with "Directory not empty". What removes it and its contents?
- `rmdir -f photos`
+ `rm -r photos`
- `rm photos`
- `del photos`
why: rmdir only removes empty directories. rm -r removes recursively.
:::

:::exercise
id: fl-mkdir
level: 1
title: Make a directory
compare: verify
---
Create a directory named `homework` in your home directory.
---verify
[ -d homework ] && echo "homework is a directory"
---solution
mkdir homework
:::

:::exercise
id: fl-touch-three
level: 1
title: Three empty files
compare: verify
---
Create three empty files in your home directory: `a.txt`, `b.txt`, `c.txt`.
---verify
ls *.txt
---solution
touch a.txt b.txt c.txt
:::

:::exercise
id: fl-copy-backup
level: 1
title: Back it up
compare: verify
---
Make a copy of `todo.txt` named `todo.bak` (keep the original).
---verify
ls todo*
cat todo.bak
---solution
cp todo.txt todo.bak
:::

:::exercise
id: fl-nested
level: 2
title: Nested in one go
compare: verify
---
With a single command, create the path `school/fall/csc316/labs`.
---verify
find school -type d | sort
---solution
mkdir -p school/fall/csc316/labs
:::

:::exercise
id: fl-rename
level: 2
title: Rename and relocate
compare: verify
---
Move `notes.txt` into the `archive` directory **and** rename it `meeting-notes.txt` in the same command.
---verify
ls archive
ls notes.txt 2>&1 || true
---solution
mv notes.txt archive/meeting-notes.txt
:::

:::exercise
id: fl-brace-structure
level: 2
title: Scaffold a project
compare: verify
---
Create this structure using brace expansion (at most two commands):

```
webapp/
├── css/style.css
├── js/app.js
└── index.html
```
---hint
`mkdir -p webapp/{css,js}` then touch the three files with braces or plain paths.
---verify
find webapp | sort
---solution
mkdir -p webapp/{css,js}
touch webapp/css/style.css webapp/js/app.js webapp/index.html
:::

:::exercise
id: fl-copy-dir
level: 2
title: Copy a whole directory
compare: verify
---
Copy the entire `projects/website` directory to a new directory `site-backup` in your home directory.
---verify
find site-backup | sort
---solution
cp -r projects/website site-backup
:::

:::exercise
id: fl-delete-dir
level: 2
title: Clear out downloads
compare: verify
---
Delete the `downloads` directory and everything in it.
---verify
ls
---solution
rm -r downloads
:::

:::exercise
id: fl-numbered
level: 3
title: Twelve months of folders
compare: verify
---
Create directories `2026-01` through `2026-12` inside a new directory `months`, using brace expansion with **zero-padded** numbers.
---hint
`{01..12}` keeps the leading zero.
---verify
ls months
---solution
mkdir -p months/2026-{01..12}
:::

:::exercise
id: fl-move-many
level: 3
title: Gather the CSVs
compare: verify
---
Create a directory `csv` and move every `.csv` file from `data/` into it (one or two commands).
---verify
ls csv
ls data
---solution
mkdir csv && mv data/*.csv csv/
:::

:::exercise
id: fl-matrix
level: 3
title: Course × assignment matrix
compare: verify
---
Create directories for three courses (`csc216`, `csc316`, `ma241`), each containing subdirectories `hw1`, `hw2` and `exam`, all inside `semester/`. One command.
---hint
Two brace groups in one path multiply: `{a,b}/{x,y}` gives four paths.
---verify
find semester -type d | sort
---solution
mkdir -p semester/{csc216,csc316,ma241}/{hw1,hw2,exam}
:::

:::exercise
id: fl-backup-trick
level: 4
title: The brace backup trick
compare: verify
---
Make a copy of `data/config.ini` named `data/config.ini.orig`, typing the path `data/config.ini` only **once**.
---hint
`{,.orig}` expands to two words: an empty suffix and `.orig`.
---verify
ls data/config*
---solution
cp data/config.ini{,.orig}
:::

:::exercise
id: proj-bash-02-scaffold
level: 2
title: "Project 2: scaffold logwatch"
compare: verify
---
Create `~/logwatch` with three subfolders `bin`, `reports` and `samples` (use brace expansion), then copy every `.log` file from `~/logs` into `~/logwatch/samples`.
---verify
find logwatch | sort
---solution
mkdir -p logwatch/{bin,reports,samples}
cp logs/*.log logwatch/samples/
:::

:::exercise
id: proj-bash-02-archive
level: 2
title: "Project 2b: archive the cron log"
compare: verify
setup: mkdir -p logwatch/samples && cp logs/*.log logwatch/samples/
---
In `~/logwatch/samples`, the cron log is small and not needed for now. **Rename** `cron.log` to `cron.log.old`, then create an empty file `README` in `~/logwatch`.
---verify
ls logwatch logwatch/samples
---solution
mv logwatch/samples/cron.log logwatch/samples/cron.log.old
touch logwatch/README
:::
