---
id: bash-sed
title: sed: the stream editor
summary: Substitution with s///, flags and capture groups, addresses and ranges, deleting and printing lines, in-place editing.
minutes: 30
---
> [!project] logwatch, step 8: anonymizing before sharing
> Taskboard's front-end developers want a copy of the access log, but IP addresses are personal data. Before logwatch hands logs to anyone, it masks them. `sed` rewrites text as it streams past.

## What sed does

`sed` reads input line by line, applies a script of editing commands to each line, and prints the result. It never modifies the file unless you ask (`-i`). It's the tool for search-and-replace in pipelines and quick file edits.

## Substitution: s/old/new/

```bash run
echo "I like cats. cats are great." | sed 's/cats/dogs/'
echo "I like cats. cats are great." | sed 's/cats/dogs/g'
```

| Flag | Effect |
|---|---|
| `g` | replace **all** matches on the line (default: only the first) |
| `2` (a number) | replace only the 2nd match |
| `i` / `I` | case-insensitive |
| `p` | print the line if a replacement happened (with `-n`) |

The pattern is a **regex** (BRE by default; `-E` for extended). In the replacement:

| Token | Inserts |
|---|---|
| `&` | the whole match |
| `\1` … `\9` | capture groups |
| `\n` | a newline (GNU) |
| `\U` / `\L` | uppercase / lowercase what follows (GNU) |

```bash run
echo "price: 42" | sed 's/[0-9]\+/$&.00/'
echo "Chen, Alice" | sed -E 's/([^,]+), (.+)/\2 \1/'
echo "hello world" | sed -E 's/\b(.)/\U\1/g'
```

### Other delimiters

When the pattern contains slashes (paths, URLs), pick another delimiter. Any character after `s` works:

```bash run
echo "/usr/local/bin/backup.sh" | sed 's|/usr/local/bin|/opt/tools|'
```

## Addresses: which lines to touch

Put an **address** before a command to restrict it:

| Address | Selects |
|---|---|
| `5` | line 5 |
| `$` | the last line |
| `/regex/` | lines matching regex |
| `2,4` | lines 2 through 4 |
| `/start/,/end/` | from a line matching start through a line matching end |
| `3,+2` | line 3 and the next 2 |
| `1~2` | every 2nd line starting at 1 (odd lines, GNU) |
| `addr!` | every line **not** matching addr |

```bash run
sed '2,3s/^/>> /' data/grades.txt | head -4
sed '/^\[database\]/,/^$/s/port=.*/port=6543/' data/config.ini
```

## Deleting, printing, inserting

| Command | Effect |
|---|---|
| `d` | delete the line (don't print it) |
| `p` | print the line (usually with `-n`, which turns off automatic printing) |
| `q` | quit after this line |
| `i text` / `a text` | insert text before / append after the line |
| `c text` | replace the line with text |
| `=` | print the line number |
| `y/abc/xyz/` | transliterate characters (like tr) |

```bash run
sed '/^#/d; /^$/d' data/config.ini
```

```bash run
sed -n '/\[high\]/p' todo.txt
sed -n '3,5p' data/words.txt
sed '3q' data/grades.txt
```

`sed -n 'Np'` is the classic way to print just line N. `sed '1d'` drops a header line.

```bash run
sed '1i name score' data/grades.txt | head -3
sed '$a -- end of report --' data/grades.txt | tail -2
```

Separate multiple commands with `;` or with multiple `-e` options.

## In-place editing

`sed -i` writes the result back to the file. GNU sed (Linux) takes `-i` alone; BSD sed (macOS) requires an argument: `sed -i '' …`. `-i.bak` keeps a backup on both.

```bash run
sed -i 's/debug=false/debug=true/' data/config.ini
grep debug data/config.ini
```

> [!warn] Test before -i
> Run the command without `-i` first and look at the output. Once `-i` runs, the original is gone unless you used `-i.bak`.

## Worked example: masking the last part of an IP

We want `192.168.1.20` → `192.168.1.x`. Build the regex against one line first:

```bash run
head -1 logs/access.log | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.x/'
```

Piece by piece:

| Piece | Meaning |
|---|---|
| `s/OLD/NEW/` | substitute |
| `^` | at the start of the line (the IP is the first field) |
| `( … )` | a **capture group**: remember this part as `\1` |
| `[0-9]+\.` | one or more digits and a literal dot (`.` alone means "any character") |
| `\1.x` | the replacement: the first three octets, then `.x` |

Then apply it to the whole file and save the result, never touching the original:

```bash run
sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.x/' logs/access.log > access.anon.log
head -3 access.anon.log
```

> [!plain] In plain English
> `sed` reads a file line by line, applies your edit commands to each line, and prints the result. Unless you ask for `-i`, the original file is never changed.

## Common mistakes

> [!mistake] `sed -i` without a backup
> `sed -i 's/…/…/' file` edits in place: a wrong regex mangles the file with no undo. Test without `-i` first, or use `-i.bak` to keep a backup. (On macOS, `sed -i` needs an argument: `sed -i '' …`.)

> [!mistake] Slashes inside the pattern
> Replacing paths like `/usr/local` gets ugly with `/` as the delimiter. Use another one: `s|/usr/local|/opt|g`.

- Add `g` to replace **every** match on a line, not just the first: `s/a/b/g`.

:::quiz
q: What does `sed 's/a/b/'` do to the line `banana`?
+ `bbnana`
- `bbnbnb`
- `banana`
- `bnana`
why: Without the g flag, only the first match on each line is replaced.
:::

:::quiz
q: Which prints only line 7 of a file?
- `sed '7d' file`
+ `sed -n '7p' file`
- `sed 's/7//' file`
- `sed '7q' file`
why: -n suppresses automatic printing; 7p prints line 7. (7q would print lines 1–7.)
:::

:::quiz
q: In `sed -E 's/(\w+) (\w+)/\2 \1/'`, what does `\2` refer to?
- the second line
+ the text matched by the second parenthesized group
- the second occurrence of the match
- a literal "2"
why: Back-references \1–\9 insert captured groups.
:::

:::quiz
q: `sed '/^$/d' file` …
- deletes the last line
+ deletes empty lines
- deletes lines with a dollar sign
- deletes the whole file
why: ^$ matches a line with nothing between start and end.
:::

:::quiz
q: Why might `sed -i 's/x/y/' file` fail on macOS?
- macOS lacks sed
+ BSD sed requires a suffix argument after -i (use `-i ''`)
- -i only works with -E
- the file must be quoted
why: GNU and BSD sed differ on -i's argument. `-i.bak` works on both.
:::

:::exercise
id: sd-replace-first
level: 1
title: Swap a word
---
Print `notes.txt` with the first occurrence of `deploy` on each line replaced by `release`.
---solution
sed 's/deploy/release/' notes.txt
:::

:::exercise
id: sd-global
level: 1
title: Commas to tabs
---
Print `data/employees.csv` with **every** comma replaced by ` | ` (space, pipe, space).
---solution
sed 's/,/ | /g' data/employees.csv
:::

:::exercise
id: sd-line
level: 1
title: Just line four
---
Print only line 4 of `data/grades.txt` using sed.
---solution
sed -n '4p' data/grades.txt
:::

:::exercise
id: sd-delete-header
level: 2
title: Drop the header
---
Print `data/sales.csv` without its first line, using sed.
---solution
sed '1d' data/sales.csv
:::

:::exercise
id: sd-strip-comments
level: 2
title: Clean config
---
Print `data/config.ini` with comment lines and blank lines removed, using a single sed command.
---solution
sed '/^#/d; /^$/d' data/config.ini
:::

:::exercise
id: sd-tags
level: 2
title: Strip the priority tags
---
Print `todo.txt` with the leading `[high] `, `[med] ` or `[low] ` tag removed from each line.
---hint
`\[[a-z]*\] ` matches a bracketed tag and its trailing space (escape the brackets).
---solution
sed 's/^\[[a-z]*\] //' todo.txt
:::

:::exercise
id: sd-range
level: 2
title: Only the database section
---
Print only the `[database]` section of `data/config.ini`: from the `[database]` line through the next blank line.
---solution
sed -n '/^\[database\]/,/^$/p' data/config.ini
:::

:::exercise
id: sd-swap-names
level: 3
title: Last, First
---
`data/contacts.txt` lines start with `First Last,`. Print just the names, converted to `Last, First` format (one per line).
---hint
`sed -E 's/^([^ ]+) ([^,]+),.*/\2, \1/'`
---solution
sed -E 's/^([^ ]+) ([^,]+),.*/\2, \1/' data/contacts.txt
:::

:::exercise
id: sd-inplace
level: 3
title: Edit a file in place
compare: verify
---
Change the server `port` in `data/config.ini` from `8080` to `9090`, editing the file in place.
---verify
cat data/config.ini
---solution
sed -i 's/^port=8080$/port=9090/' data/config.ini
:::

:::exercise
id: sd-section-edit
level: 3
title: Edit one section only
---
Print `data/config.ini` with `host=` changed to `host=localhost` **only within the `[cache]` section**. Other sections' hosts stay unchanged.
---hint
A range address limits the substitution: `/^\[cache\]/,/^$/s/…/…/`. The cache section is the last one, so the range runs to end of file.
---solution
sed '/^\[cache\]/,/^$/s/^host=.*/host=localhost/' data/config.ini
:::

:::exercise
id: sd-dates
level: 4
title: Reformat dates
---
In `data/sales.csv` (skip the header), rewrite each ISO date `YYYY-MM-DD` at the start of the line as `MM/DD/YYYY`, leaving the rest of the line intact.
---solution
sed -E '1d; s#^([0-9]{4})-([0-9]{2})-([0-9]{2})#\2/\3/\1#' data/sales.csv
:::

:::exercise
id: sd-html-strip
level: 4
title: Strip HTML tags
---
Print `projects/website/index.html` with all HTML tags removed and lines that become empty or whitespace-only deleted.
---hint
Tags: `<[^>]*>`. Then delete lines matching `^[[:space:]]*$`.
---solution
sed 's/<[^>]*>//g; /^[[:space:]]*$/d' projects/website/index.html
:::

:::exercise
id: proj-bash-08-anon
level: 3
title: "Project 8: anonymize the access log"
path: ops/commands/08-anon.sh
---
Print `logs/access.log` with the **last octet** of every client IP replaced by `x` (e.g. `10.0.0.5` → `10.0.0.x`). Use `sed -E` with a capture group.
---solution
sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.x/' logs/access.log
:::

:::exercise
id: proj-bash-08-users
level: 3
title: "Project 8b: hide user names"
path: ops/commands/08-users.sh
---
Lines in `logs/app.log` can contain `user=NAME`. Print only the lines containing `user=`, with every name replaced by `user=***`.
---hint
`sed -n` with the `p` flag prints only lines where a substitution happened.
---solution
sed -nE 's/user=[a-z]+/user=***/gp' logs/app.log
:::
