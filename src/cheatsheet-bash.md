## Navigation and files

| Command | Does |
|---|---|
| `pwd` / `cd DIR` / `cd -` / `cd` | where am I / go / go back / go home |
| `ls -la` `ls -lhS` `ls -lt` | all + long / by size / by time |
| `tree -L 2` | directory tree |
| `mkdir -p a/b/c` | create path |
| `touch f` | create empty file |
| `cp f g` `cp -r d e` | copy file / directory |
| `mv f g` | move or rename |
| `rm f` `rm -r d` `rmdir d` | delete file / tree / empty dir |
| `cat -n` `head -n 5` `tail -n +2` `wc -l` | read / first / from line 2 / count |

## Expansion order

brace `{a,b}` `{1..5}` → tilde `~` → `$var` `${…}` → `$(cmd)` → `$((math))` → word splitting → globbing `* ? [ ]` → quote removal.

| Quote | Behavior |
|---|---|
| `'…'` | totally literal |
| `"…"` | `$var`, `$(…)`, `\` work; no splitting or globbing |
| `\c` | escape one character |
| `$'\t'` | ANSI-C escapes |

Always quote: `"$var"`, `"$@"`, `"$(cmd)"`.

## Redirection

| Syntax | Meaning |
|---|---|
| `> f` / `>> f` | stdout to file (truncate / append) |
| `2> f` | stderr to file |
| `> f 2>&1` or `&> f` | both to file (order matters!) |
| `2>/dev/null` | discard errors |
| `< f` | file as stdin |
| `a \| b` | a's stdout → b's stdin |
| `tee f` | copy to file and stdout |
| `<<EOF … EOF` | heredoc (`<<'EOF'` = no expansion) |
| `<<< "str"` | here string |
| `<(cmd)` | command output as a file |

## Text tools

```bash
sort [-n] [-r] [-u] [-t,] [-k2,2nr]     # sort lines
uniq [-c] [-d] [-u]                      # adjacent duplicates (sort first!)
cut -d, -f1,3        cut -c1-5           # columns / characters
tr 'a-z' 'A-Z'   tr -d ','   tr -s ' '   tr -cd '0-9'
paste -sd+ | bc                          # sum a column
column -t -s,                            # align a table
comm -23 <(sort a) <(sort b)             # only in a
... | sort | uniq -c | sort -rn | head   # frequency count
```

## grep and regex

`grep -i -v -c -n -l -o -w -x -r -E -F -q -A/-B/-C N 'pattern' files`

| Regex (ERE) | Meaning |
|---|---|
| `.` | any char (`\.` literal dot) |
| `^` `$` | line start / end |
| `[abc]` `[^0-9]` `[[:space:]]` | classes |
| `*` `+` `?` `{n,m}` | quantifiers (BRE: `\+ \? \{n,m\}`) |
| `(a\|b)` | group, alternation (BRE: `\( \| \)`) |
| `\b` `\<` `\>` | word boundaries |

## sed

```bash
sed 's/old/new/g' f            # replace all on each line
sed -E 's/(\w+) (\w+)/\2 \1/'  # groups
sed -n '5p'      sed '1d'      sed '/^#/d'       sed -n '/start/,/end/p'
sed '3i text'    sed '$a text'
sed -i 's/a/b/' f              # in place (macOS: sed -i '' …)
```

## awk

```bash
awk '{ print $1, $NF }' f                     # fields; NF = field count
awk -F, 'NR > 1 && $4 > 100 { print $2 }' f   # separator, skip header, filter
awk '{ s += $2 } END { print s, s / NR }' f   # sum and average
awk '{ c[$1]++ } END { for (k in c) print k, c[k] }' f   # group/count
awk '{ printf "%-10s %6.2f\n", $1, $2 }' f    # formatting
awk -v x="$shellvar" '$1 == x' f              # pass a shell value
```

## find, xargs, permissions

```bash
find . -name '*.log' -type f -size +1k -mtime -7
find . -name '*.tmp' -delete
find . -name '*.c' -exec wc -l {} +
find . -name '*.txt' | xargs grep -l TODO
ls *.jpg | xargs -I {} cp {} backup/{}
chmod 755 f     chmod u+x f     chmod go-w f     chmod -R 644 dir
```

r = 4, w = 2, x = 1 per user/group/other: `754` = `rwxr-xr--`.

## Variables and expansion

```bash
name="value"            # no spaces around =
export NAME             # visible to child processes
n=$(wc -l < f)          # command substitution
echo $((a * b + 1))     # integer math;  ((i++))
${v:-default} ${v:=default} ${v:+alt} ${v:?error}
${#v}  ${v:2:3}  ${v^^}  ${v,,}
${v#pre} ${v##pre}  ${v%suf} ${v%%suf}   # trim (# start, % end; doubled = greedy)
${v/a/b}  ${v//a/b}                       # replace first / all
```

## Scripts

```bash
#!/bin/bash
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 FILE" >&2; exit 1; }
```

`$0` name · `$1…` args · `$#` count · `"$@"` all args · `$?` last status · `shift`

## Tests and branching

| Test | True if |
|---|---|
| `-f p` `-d p` `-e p` `-s p` `-x p` | file / dir / exists / non-empty / executable |
| `-z "$s"` `-n "$s"` | empty / non-empty |
| `"$a" = "$b"` `!=` | string equality |
| `$a -eq $b` `-ne -lt -le -gt -ge` | integers |
| `[[ $f == *.txt ]]` | glob match |
| `[[ $s =~ ^[0-9]+$ ]]` | regex (`BASH_REMATCH`) |
| `(( n > 5 && n % 2 == 0 ))` | arithmetic |

```bash
if cond; then …; elif cond; then …; else …; fi
case "$x" in a|b) … ;; *.txt) … ;; *) … ;; esac
cmd && on_success || on_failure
```

## Loops

```bash
for x in a b c; do …; done
for f in *.txt; do …; done
for i in {1..10}; do …; done
for ((i = 0; i < n; i++)); do …; done
while IFS=, read -r a b c; do …; done < file.csv   # not cat | while (subshell!)
until cond; do …; done
break / continue
```

## Functions and arrays

```bash
f() { local x=$1; echo "$((x * 2))"; }    # output = data
ok() { (( $1 > 0 )); }                    # exit status = boolean
y=$(f 21)

arr=(a "b c" d); arr+=(e)
"${arr[@]}"  ${#arr[@]}  ${arr[0]}  ${!arr[@]}  ${arr[@]:1:2}
mapfile -t lines < file

declare -A m=([k]=v); m[x]=1
"${!m[@]}" (keys)   "${m[@]}" (values)

while getopts "vn:" o; do case $o in v) …;; n) n=$OPTARG;; esac; done
shift $((OPTIND - 1))
```
