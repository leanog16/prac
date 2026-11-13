---
id: bash-nav
title: The shell & navigation
summary: What a shell actually does, how paths work, and moving around the filesystem with pwd, ls and cd.
minutes: 20
---
> [!project] Track project: logwatch, a log-analysis toolkit
> The server behind a small web shop writes three logs into `~/logs`: `access.log` (every web request), `app.log` (the application's messages) and `cron.log` (scheduled jobs). Through this track you'll build **logwatch**: first as one-line commands, then as a real script, `logwatch.sh`, with options, functions and error handling. Each lesson ends with a **Project** exercise. Everything you build runs against those real log files.

## What is the shell?

A **shell** is a program that reads a line of text, figures out what command you meant, runs it, and prints the result. **Bash** (the Bourne Again SHell) is the most common one on Linux servers; macOS ships **zsh**, which behaves almost identically for everything in this course.

Every command line has the same anatomy:

```bash
ls -l -a /home/student/data
```

| Part | Example | Meaning |
|---|---|---|
| command | `ls` | the program to run |
| options (flags) | `-l -a` | change how it behaves; short flags can be combined: `-la` |
| arguments | `/home/student/data` | what to operate on |

Bash splits the line on spaces into *words*. The first word is the command; the rest are handed to it. Much of shell mastery is knowing exactly how bash turns your line into words, which we'll study in the quoting lesson.

> [!note] The terminal on this site
> Every runnable block executes in **minibash**, a bash simulator running in your browser with a practice home folder at `/home/student`. It supports pipes, redirection, variables, loops, functions, grep/sed/awk and ~70 commands. Every exercise starts from a fresh copy, so experiment freely. For a free-play terminal, open the [Bash terminal](#bash-terminal).

## Where am I? `pwd`

The shell always has a **current working directory**. `pwd` prints it:

```bash run
pwd
```

## What's here? `ls`

```bash run
ls
```

The most useful flags:

| Flag | Effect |
|---|---|
| `-l` | long format: permissions, size, date |
| `-a` | include hidden files (names starting with `.`) |
| `-h` | human-readable sizes with `-l` (4.0K, 1.2M) |
| `-t` | sort by modification time, newest first |
| `-r` | reverse the sort |
| `-S` | sort by size, largest first |
| `-R` | recurse into subdirectories |
| `-1` | one name per line |

```bash run
ls -la
```

Files that start with a dot (`.bashrc`, `.secret`) are **hidden**: ordinary `ls` skips them. Every directory also contains two special entries: `.` (this directory) and `..` (the parent).

```bash run
ls -l data
```

## Paths: absolute vs relative

A **path** names a location in the tree. The tree starts at `/`, the *root*.

- An **absolute path** starts with `/` and works from anywhere: `/home/student/data/grades.txt`
- A **relative path** is interpreted from the current directory: `data/grades.txt`
- `~` expands to your home directory: `~/data` is `/home/student/data`
- `..` goes up one level, `.` is "here"

```bash run
ls /home/student/logs
ls logs
ls ~/logs
```

All three list the same directory (when you're in `/home/student`).

## Moving around: `cd`

`cd DIR` changes the working directory. Some shortcuts:

| Command | Goes to |
|---|---|
| `cd` | your home directory |
| `cd ~` | your home directory |
| `cd ..` | the parent directory |
| `cd -` | the previous directory (and prints it) |
| `cd /` | the root |

```bash run
cd data
pwd
cd ../logs
pwd
cd -
cd
pwd
```

> [!tip] Tab completion
> In a real terminal (and in this site's terminal), press **Tab** to complete file and command names. Press it twice to list candidates. It saves typing *and* typos.

## Visualizing the tree

`tree` draws a directory hierarchy. It isn't installed everywhere by default, but it's great for understanding structure:

```bash run
tree projects
```

## Getting help

- `man ls` opens the manual page (press `q` to quit in a real terminal).
- Most GNU tools accept `--help`.
- `type cd` tells you whether something is a builtin, a keyword or a program.

```bash run
type cd
type ls
type if
```

`cd` *must* be a shell builtin: a separate program couldn't change the shell's own working directory.

## Worked example: exploring a machine you've never seen

You've just logged in to a server. The first minute always looks the same:

```bash run
pwd
ls
ls -l logs
```

Read `ls -l` column by column:

```
-rw-r--r-- 1 student student 3412 Oct 20 09:00 access.log
│└┬┘└┬┘└┬┘   └──┬──┘ └──┬──┘ └┬─┘ └────┬─────┘ └───┬────┘
│ │  │  │      owner   group   size   modified      name
│ │  │  └ others can read
│ │  └ group can read
│ └ owner can read and write
└ "-" = regular file ("d" = directory, "l" = link)
```

Then look around without losing your place. Relative paths are resolved from where you are, absolute ones from `/`:

```bash run
cd logs
pwd
ls ..
cd ~
pwd
```

> [!plain] In plain English
> The shell always has a **current directory**. Commands look for files there unless you give a path starting with `/` (absolute) or `~` (your home).

## Common mistakes

> [!mistake] Spaces in names
> `cd My Documents` tries to `cd` into `My` with an extra argument. Quote it (`cd "My Documents"`) or press Tab to let the shell escape it for you.

> [!mistake] Forgetting where you are
> Most "file not found" errors are really "wrong directory". When in doubt, `pwd`. And use **Tab completion** constantly: it's faster and it never makes typos.

- `cd -` jumps back to the previous directory, `cd` alone goes home.
- `ls -a` shows hidden files (names starting with `.`), like `.bashrc`.

:::quiz
q: You are in `/home/student/data`. Which path refers to `/home/student/logs/app.log`?
- `logs/app.log`
+ `../logs/app.log`
- `./logs/app.log`
- `/logs/app.log`
why: `..` moves up to /home/student, then into logs. Paths starting with `/` are absolute, so `/logs/app.log` means a top-level logs directory.
:::

:::quiz
q: Why doesn't plain `ls` show `.bashrc`?
- It's a system file only root can see
+ Names starting with a dot are hidden unless you use `-a`
- `ls` only lists directories
- It's in a different directory
why: The leading dot is the whole hiding mechanism. `ls -a` (or `-A`) shows them.
:::

:::quiz
q: What does `cd -` do?
- Goes to the root directory
- Goes up one level
+ Returns to the previous working directory
- Nothing, it's an error
why: `cd -` swaps back to $OLDPWD and prints it. Great for bouncing between two directories.
:::

:::exercise
id: nav-pwd
level: 1
title: Where am I?
---
Print the current working directory.
---solution
pwd
:::

:::exercise
id: nav-ls-logs
level: 1
title: Peek into logs
---
List the contents of the `logs` directory (one command, without changing directory).
---solution
ls logs
:::

:::exercise
id: nav-hidden
level: 1
title: Find the hidden files
---
List **all** entries in your home directory, including hidden ones, but excluding `.` and `..`, one per line.
---hint
`-A` is like `-a` but skips `.` and `..`. `-1` forces one name per line.
---solution
ls -A1
:::

:::exercise
id: nav-cd-pwd
level: 2
title: Go there, prove it
---
Change into `projects/api/tests`, then print the working directory, both in one command line (separate commands with `;` or `&&`).
---hint
`cmd1 && cmd2` runs the second only if the first succeeds.
---solution
cd projects/api/tests && pwd
:::

:::exercise
id: nav-relative-up
level: 2
title: Up and over
cwd: /home/student/projects/website
---
You start in `/home/student/projects/website`. Using a **relative** path, list the contents of `/home/student/projects/api`.
---hint
Go up one level with `..`, then into `api`.
---solution
ls ../api
:::

:::exercise
id: nav-long-sizes
level: 3
title: Largest first
---
Show a long listing of the `data` directory sorted by file size, largest first.
---hint
Combine `-l` with the sort-by-size flag.
---solution
ls -lS data
:::

:::exercise
id: nav-cd-dash
level: 3
title: Bounce back
---
In one command line: change to `/home/student/logs`, then to `/tmp`, then use the "previous directory" shortcut to return, and finally print the working directory with `pwd`.
---hint
`cd -` prints the directory it switches to, so your output will have two lines. That's expected.
---solution
cd /home/student/logs; cd /tmp; cd -; pwd
:::

:::exercise
id: nav-tree-depth
level: 3
title: Two levels deep
---
Show the tree of the `projects` directory, limited to 2 levels deep.
---hint
`tree -L N` limits depth.
---solution
tree -L 2 projects
:::

:::exercise
id: proj-bash-01-survey
level: 1
title: "Project 1: survey the logs"
---
Start the logwatch project by looking at what you have: list the files in `~/logs` in **long format with human-readable sizes**.
---hint
`ls` with `-l` and `-h`.
---solution
ls -lh logs
:::

:::exercise
id: proj-bash-01-tree
level: 1
title: "Project 1b: the big picture"
---
Show the directory tree of your home folder, but only **2 levels** deep, so you can see where the logs sit relative to everything else.
---solution
tree -L 2
:::
