---
id: bash-find
title: find, xargs & permissions
summary: Searching the tree by name, type, size and more; acting on results with -exec and xargs; reading and changing permissions with chmod.
minutes: 30
---
> [!project] logwatch, step 10: finding logs anywhere
> Real servers keep logs in many folders, rotated into `app.log.1`, `app.log.2.gz` and so on. logwatch needs to **find** them, and its script needs the right **permissions** to run.

## find walks the tree

`find START [tests…] [actions…]` recursively visits every path under START and prints the ones that pass all the tests.

```bash run
find projects
```

| Test | Matches |
|---|---|
| `-name 'pat'` | basename matches a glob (quote it!) |
| `-iname 'pat'` | same, case-insensitive |
| `-type f` / `-type d` | regular files / directories |
| `-path 'pat'` | the whole path matches a glob |
| `-size +10k`, `-size -1M` | bigger / smaller than (c = bytes, k, M, G) |
| `-empty` | empty files or directories |
| `-mtime -7` | modified in the last 7 days |
| `-newer file` | modified more recently than file |
| `-maxdepth N`, `-mindepth N` | limit how deep to go |
| `! test`, `-not test` | negate |
| `test1 -o test2` | or (tests are ANDed by default) |
| `\( … \)` | group tests, like parentheses in math; the backslashes stop bash from treating `(` `)` specially |

Mixing "or" with other tests needs grouping, because "and" binds tighter: `find . \( -name '*.csv' -o -name '*.tsv' \) -size +1k` means "(csv or tsv) and bigger than 1 KB".

```bash run
find . -name '*.csv'
find . -type d -name 'p*'
find photos -iname '*.png'
find . -maxdepth 1 -type f
find . -type f -empty
```

> [!warn] Quote the pattern
> Write `find . -name '*.txt'`, not `find . -name *.txt`. Unquoted, bash expands `*.txt` against the *current* directory before find runs, and the search silently changes meaning.

## Acting on what you find

### -exec

`-exec cmd {} \;` runs `cmd` once per match, with `{}` replaced by the path. The `\;` (escaped semicolon) ends the command. `-exec cmd {} +` passes many paths to a single invocation, which is much faster.

```bash run
find data -name '*.csv' -exec wc -l {} \;
find data -name '*.txt' -exec wc -l {} +
```

`-delete` removes matches (careful!). `-print` is the default action.

### xargs

`xargs` turns lines of stdin into **arguments** for a command. Pipes feed stdin; many commands (rm, mkdir, wc with filenames) want arguments instead. xargs bridges the gap.

```bash run
find logs -name '*.log' | xargs wc -l
echo "alpha beta gamma" | xargs -n 1 echo item:
```

| Option | Effect |
|---|---|
| `-n N` | at most N arguments per command |
| `-I {}` | run once per line, substituting `{}` anywhere |
| `-0` | input separated by NUL bytes (pair with `find -print0`) for filenames with spaces |
| `-t` | print each command before running it |

```bash run
ls data/*.txt | xargs -I {} cp {} {}.bak
ls data
```

## Permissions

Every file has an owner, a group, and three sets of permissions: for the **u**ser (owner), the **g**roup, and **o**thers.

```bash run
ls -l scripts
```

```
-rwxr-xr-x  1 student student  211 Oct 20 09:15 backup.sh
│└┬┘└┬┘└┬┘
│ │  │  └── others: r-x
│ │  └───── group:  r-x
│ └──────── user:   rwx
└────────── type: - file, d directory, l link
```

| Bit | On a file | On a directory |
|---|---|---|
| `r` read | view contents | list entries |
| `w` write | modify | create/delete entries |
| `x` execute | run as a program | enter (`cd`) and access entries |

### Octal notation

Each set is three bits: r = 4, w = 2, x = 1. Add them per set.

| Octal | Symbolic | Typical use |
|---|---|---|
| `755` | `rwxr-xr-x` | scripts and directories |
| `644` | `rw-r--r--` | ordinary files |
| `700` | `rwx------` | private directory |
| `600` | `rw-------` | private files (SSH keys) |
| `777` | `rwxrwxrwx` | almost never a good idea |

### chmod

```bash
chmod 755 script.sh        # octal
chmod u+x script.sh        # add execute for the owner
chmod go-w file            # remove write from group and others
chmod a+r file             # add read for all
chmod -R 755 dir           # recursive
```

```bash run
ls -l scripts/hello.sh
./scripts/hello.sh 2>&1   # fails on purpose
chmod +x scripts/hello.sh
ls -l scripts/hello.sh
./scripts/hello.sh
```

> [!exam] Running scripts
> `./script.sh` needs the execute bit (and a shebang line). `bash script.sh` doesn't: bash just reads the file. The `./` is required because the current directory isn't in `$PATH`.

## Worked example: find, then act

`find` has three parts: **where** to start, **tests** to filter, and an **action**:

```bash run
find . -name '*.log'
find . -name '*.log' -size +1k
find . -type f -name '*.log' -exec wc -l {} +
```

- Quote the pattern (`'*.log'`), so `find` gets the wildcard instead of the shell expanding it first.
- `-exec cmd {} +` passes found files to `cmd` in batches (fast). `-exec cmd {} \;` runs it once per file.
- Combine with `xargs` when the next command reads arguments: `find . -name '*.log' -print0 | xargs -0 grep -l ERROR`. The `-print0`/`-0` pair keeps file names with spaces intact.

## Making the script executable

A script is just a text file until it has the **execute** permission:

```bash run
mkdir -p logwatch/bin
printf '#!/bin/bash\necho "logwatch ready"\n' > logwatch/bin/logwatch.sh
ls -l logwatch/bin/logwatch.sh
chmod +x logwatch/bin/logwatch.sh
ls -l logwatch/bin/logwatch.sh
./logwatch/bin/logwatch.sh
```

Permissions in numbers: read = 4, write = 2, execute = 1, added up for owner, group and others. `chmod 755` = `rwxr-xr-x` (typical for scripts), `chmod 644` = `rw-r--r--` (typical for data), `chmod 600` = only you can read and write (for secrets like SSH keys).

> [!plain] In plain English
> `find` walks every folder under a starting point and prints paths that pass your tests. Add an action and it does something with each one.

## Common mistakes

> [!mistake] `find -name *.log` without quotes
> If the current directory contains `a.log`, the shell turns the command into `find -name a.log` and you only find files named exactly `a.log`.

> [!mistake] `chmod 777`
> "Everyone can write and execute" is almost never what you want. Give the minimum: 755 for scripts, 644 for files, 600 for secrets.

:::quiz
q: What octal mode is `rwxr-x---`?
- 755
+ 750
- 640
- 570
why: rwx = 7, r-x = 5, --- = 0.
:::

:::quiz
q: Which finds directories named `tests` anywhere under the current directory?
+ `find . -type d -name tests`
- `find tests -type d`
- `ls -R | grep tests`
- `find . -name tests -type f`
why: -type d restricts to directories; -name matches the basename.
:::

:::quiz
q: Why is `find . -name '*.log'` quoted?
- find requires quotes around every argument
+ so bash doesn't expand the glob itself before find sees it
- to make the match case-insensitive
- quotes speed up the search
why: Unquoted, bash would replace *.log with matching names from the current directory.
:::

:::quiz
q: `find . -name '*.tmp' | xargs rm` does what?
- prints the files
+ deletes every .tmp file found (passing the names as arguments to rm)
- deletes nothing because rm reads stdin
- errors because rm can't be used with pipes
why: xargs converts the list on stdin into rm's arguments.
:::

:::quiz
q: You can't `cd` into a directory but can list its contents with ls. Which permission is missing?
- r
- w
+ x
- none
why: Execute permission on a directory is what allows entering it and accessing its entries.
:::

:::exercise
id: fd-csv
level: 1
title: Find the CSVs
---
Find every file ending in `.csv` anywhere under your home directory (start the search at `.`).
---solution
find . -name '*.csv'
:::

:::exercise
id: fd-dirs
level: 1
title: Just directories
---
List every directory under `projects` (including `projects` itself) using find.
---solution
find projects -type d
:::

:::exercise
id: fd-chmod-x
level: 1
title: Make it executable
compare: verify
---
Give `scripts/hello.sh` execute permission for its owner.
---verify
ls -l scripts/hello.sh | cut -c1-10
---solution
chmod u+x scripts/hello.sh
:::

:::exercise
id: fd-iname
level: 2
title: Images, any case
---
Find all files under `photos` and `downloads` whose names end in `.jpg`, `.JPG`, `.png` or `.PNG` (case-insensitive). Print paths sorted alphabetically.
---hint
`find photos downloads \( -iname '*.jpg' -o -iname '*.png' \) | sort`
---solution
find photos downloads \( -iname '*.jpg' -o -iname '*.png' \) | sort
:::

:::exercise
id: fd-empty
level: 2
title: Empty things
---
Find all **empty** files under `photos`, printed in sorted order.
---solution
find photos -type f -empty | sort
:::

:::exercise
id: fd-octal
level: 2
title: Private file
compare: verify
---
Set `data/contacts.txt` so that only the owner can read and write it (no access for group or others), using octal.
---verify
ls -l data/contacts.txt | cut -c1-10
---solution
chmod 600 data/contacts.txt
:::

:::exercise
id: fd-exec-count
level: 3
title: Count lines in every log
---
For each `.log` file under `logs`, print its line count and name (as `wc -l` prints them), running `wc -l` **once per file** via `find -exec`.
---solution
find logs -name '*.log' -exec wc -l {} \;
:::

:::exercise
id: fd-xargs-grep
level: 3
title: Which Python files have TODOs?
---
Use `find` to list `.py` files under `projects`, and `xargs` with `grep -l` to print only those that contain `TODO`.
---solution
find projects -name '*.py' | xargs grep -l TODO
:::

:::exercise
id: fd-maxdepth
level: 3
title: Top-level text files
---
List the `.txt` files directly in your home directory only (not in subdirectories), with find. Sort the output.
---solution
find . -maxdepth 1 -name '*.txt' | sort
:::

:::exercise
id: fd-organize
level: 4
title: Organize downloads
compare: verify
---
Inside `downloads`, create subdirectories `docs`, `images` and `audio`. Move `.pdf` and `.pptx` and `.xlsx` files into `docs`, `.jpg`/`.JPG` into `images`, and `.mp3` into `audio`. Leave everything else in place.
---hint
`mkdir -p downloads/{docs,images,audio}`, then `mv` with globs like `downloads/*.{pdf,pptx,xlsx}`. A glob that matches nothing is an error for mv, so `*.[jJ][pP][gG]` is safer than listing `*.jpg *.JPG`.
---verify
find downloads | sort
---solution
mkdir -p downloads/{docs,images,audio}
mv downloads/*.{pdf,pptx,xlsx} downloads/docs/
mv downloads/*.[jJ][pP][gG] downloads/images/
mv downloads/*.mp3 downloads/audio/
:::

:::exercise
id: fd-exec-plus
level: 4
title: Backup every script
compare: verify
---
Copy every `.sh` file found anywhere under your home directory into `archive/` using a single `find … -exec` command.
---verify
ls archive
---solution
find . -name '*.sh' -not -path './archive/*' -exec cp {} archive/ \;
:::

:::exercise
id: fd-perm-report
level: 4
title: Who can run what?
---
Print the names (just the basename, sorted) of all files under `scripts` that are **executable by their owner**.
---hint
`ls -l` then awk on the first column (`substr($1, 4, 1) == "x"`), or find's `-perm`.
---solution
ls -l scripts | awk 'NR > 1 && substr($1, 4, 1) == "x" { print $NF }' | sort
:::

:::exercise
id: proj-bash-10-find-logs
level: 2
title: "Project 10: every log over 1 KB"
path: ops/commands/10-find-logs.sh
---
From your home directory, find all regular files whose names end in `.log` and that are **larger than 1 KB**, and print their line counts with a single `-exec … +`.
---solution
find . -type f -name '*.log' -size +1k -exec wc -l {} +
:::

:::exercise
id: proj-bash-10-chmod
level: 2
title: "Project 10b: install the script"
compare: verify
setup: mkdir -p logwatch/bin && printf '#!/bin/bash\necho "logwatch ready"\n' > logwatch/bin/logwatch.sh
path: ops/commands/10-chmod.sh
---
`~/logwatch/bin/logwatch.sh` exists but isn't executable. Give it permissions `rwxr-xr-x` using **numeric** mode, then run it.
---verify
ls -l logwatch/bin/logwatch.sh | cut -c1-10
---solution
chmod 755 logwatch/bin/logwatch.sh
./logwatch/bin/logwatch.sh
:::
