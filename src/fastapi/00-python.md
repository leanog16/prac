---
id: fastapi-python
title: Python for API developers
summary: The Python this track builds on, from scratch — values and variables, strings and f-strings, lists, dicts and sets, conditions and loops, comprehensions, functions and type hints, imports, classes, exceptions, with, decorators, lambda, yield and dates.
minutes: 45
---
> [!project] Track project: Taskboard, a task-tracking API
> Across this track you'll build **Taskboard**, the task tracker that runs through every track on this site: an API where a small team creates tasks, moves them from `todo` to `doing` to `done`, assigns them, attaches files and gets live updates. FastAPI apps are written in Python, so this first lesson covers the Python the rest of the track uses, with Taskboard's tasks as the examples. Each lesson's **Project** exercises add a piece of the API, saved to `app/` in your Taskboard repo. The Docker, CI/CD and AWS tracks package, test and deploy the same app.

## Who this lesson is for

If you already write Python comfortably, skim the headings, take the quick check, and move on. If Python is new, read it top to bottom: every later lesson assumes exactly what's here, and nothing more. To try the snippets yourself, install Python 3.12 and run `python3` in a terminal, which opens an interactive prompt where you can type lines and see results.

> [!note] How Python exercises are graded here
> There's no Python runtime in your browser. "Predict" exercises ask what a snippet prints; code exercises are checked against a list of requirements (click **Requirements** to see it before you start).

## Values and variables

```python
title = "Write the API"      # str: text, in single or double quotes
priority = 2                 # int: whole number
estimate = 1.5               # float: decimal number
done = False                 # bool: True or False (capitalized)
assignee = None              # None: "no value", Python's null

print(title, priority)       # Write the API 2
```

- `=` stores a value in a variable; there's no declaration keyword.
- `#` starts a comment.
- `print(...)` writes its arguments to the screen, separated by spaces.
- **Indentation is syntax**: the lines inside an `if`, a loop or a function are indented (4 spaces by convention), and the indentation is what ends the block. There are no braces.

## Strings and f-strings

```python
name = "Ana"
count = 3
print(f"{name} has {count} open tasks")    # Ana has 3 open tasks
print("todo".upper())                      # TODO
print("  padded  ".strip())                # padded
print("API" in "Write the API")            # True
```

An **f-string** (an `f` before the opening quote) replaces each `{expression}` with its value. Methods like `.upper()`, `.lower()` and `.strip()` return a new string; strings never change in place.

## Lists

A **list** is an ordered, changeable sequence:

```python
tasks = ["design", "build", "test"]
tasks[0]            # "design"   (indexes start at 0)
tasks[-1]           # "test"     (negative indexes count from the end)
tasks[:2]           # ["design", "build"]   (a slice: up to, not including, index 2)
len(tasks)          # 3
tasks.append("ship")        # add to the end
tasks.pop()                 # remove and return the last item: "ship"
tasks.pop(0)                # remove and return item 0: "design"
"build" in tasks            # True
sorted([3, 1, 2])           # [1, 2, 3]  (a new sorted list)
```

A **tuple** is like a list that can't change, written with parentheses: `point = (3, 4)`. Functions often return tuples, and you can unpack them: `x, y = point`.

## Dicts

A **dict** maps keys to values. Taskboard's tasks are dicts before they become models:

```python
task = {"id": 1, "title": "Write API", "status": "todo"}
task["title"]               # "Write API"
task["status"] = "doing"    # change a value (or add a new key)
task.get("assignee")        # None: .get returns None for a missing key...
task.get("assignee", "nobody")   # ...or the default you pass
task["assignee"]            # KeyError! Square brackets fail on a missing key
"status" in task            # True: checks the keys
del task["status"]          # remove a key
task.pop("title")           # remove a key and return its value
task.keys(), task.values(), task.items()   # views of keys, values, (key, value) pairs
```

`{**task, "status": "done"}` builds a **new** dict: `**` unpacks all of `task`'s keys and values into it, then `"status"` overrides one of them. The same `**` passes a dict's entries as named arguments to a function: `Task(**data)` is `Task(id=1, title="Write API", …)`.

A **set** holds unique values with no order: `labels = {"bug", "urgent"}`, `labels.add("docs")`, `"bug" in labels`. Adding a value that's already there does nothing.

## Conditions

```python
if task["status"] == "done":
    print("finished")
elif task["status"] == "doing" and task.get("assignee") is not None:
    print("in progress")
else:
    print("waiting")
```

- Comparisons: `==`, `!=`, `<`, `<=`, `>`, `>=`. Combine with `and`, `or`, `not`.
- Test for `None` with `is None` / `is not None`.
- Empty things count as false: `if tasks:` is true when the list has items; `0`, `""`, `[]`, `{}` and `None` are all false.

## Loops

```python
for task in tasks:                       # each item in turn
    print(task)

for i, task in enumerate(tasks, start=1):    # with a counter: 1, 2, 3…
    print(i, task)

for key, value in task.items():          # a dict's pairs
    print(key, value)

for n in range(3):                       # 0, 1, 2
    print(n)
```

`break` leaves a loop early; `continue` skips to the next item. `while condition:` repeats while the condition is true.

## Comprehensions

A **comprehension** builds a list (or dict) from a loop in one expression:

```python
open_tasks = [t for t in all_tasks if t["status"] != "done"]
titles = [t["title"] for t in all_tasks]
by_id = {t["id"]: t for t in all_tasks}           # a dict comprehension
```

Read `[t["title"] for t in all_tasks]` as "the title of each t in all_tasks". The optional `if` keeps only matching items.

Built-in functions take the same kind of loop without the brackets: `sum(t["estimate"] for t in tasks)`, `any(t["status"] == "doing" for t in tasks)`. `max(t["id"] for t in tasks)` finds the largest id but fails on an empty list; `max((t["id"] for t in tasks), default=0)` returns 0 instead. (When the loop isn't the only argument, it needs its own parentheses.)

## Functions and type hints

```python
def task_key(task_id: int, prefix: str = "TB") -> str:
    return f"{prefix}-{task_id}"

task_key(42)                 # "TB-42"
task_key(42, prefix="OPS")   # "OPS-42": a keyword argument names the parameter
```

- `def name(parameters):` defines a function; `return` sends a value back (without it, the function returns `None`).
- `prefix: str = "TB"` is a parameter with a **default**, used when the caller leaves it out.
- `task_id: int` and `-> str` are **type hints**: they say what type each parameter and the result should be. Python itself doesn't enforce them, but tools do, and **FastAPI reads them** to validate requests. That's why this track is so particular about them.

Common hint shapes:

| Hint | Means |
|---|---|
| `int`, `str`, `float`, `bool` | that type |
| `list[str]` | a list of strings |
| `dict[str, int]` | a dict with string keys and int values |
| `str \| None` | a string or `None` (an optional value) |
| `Optional[str]` | the older spelling of `str \| None` (`from typing import Optional`) |

`def f(*args, **kwargs)` accepts any number of extra positional and named arguments; you'll mostly see it in library code.

## Modules and imports

Every `.py` file is a **module**. A folder of modules with an `__init__.py` file in it is a **package**.

```python
import json                          # use as json.dumps(...)
from typing import Annotated         # bring one name in directly
from fastapi import FastAPI, Query   # several names
from routers import tasks            # the module routers/tasks.py; use tasks.router
```

## Classes

A **class** bundles data (attributes) with functions that work on it (methods):

```python
class Task:
    def __init__(self, title: str, status: str = "todo"):
        self.title = title           # attributes live on self
        self.status = status

    def finish(self) -> None:
        self.status = "done"


t = Task("Write tests")     # calls __init__; t is an *instance* of Task
t.finish()
print(t.title, t.status)    # Write tests done
```

- `__init__` runs when you create an instance; it sets up the attributes.
- Every method's first parameter is `self`, the instance it was called on.
- `class Child(Parent):` **inherits** everything from `Parent`. FastAPI's models work this way: `class TaskCreate(BaseModel):` gets validation from Pydantic's `BaseModel`, and you only list the fields, as annotated class attributes (`title: str`), with no `__init__` (lesson 5).
- `isinstance(t, Task)` checks whether a value is an instance of a class.

Two decorators you'll see on methods: `@property` makes a method readable like an attribute (`t.is_late` instead of `t.is_late()`), and `@classmethod` makes a method receive the class instead of an instance (lesson 12 uses both).

## Exceptions

Errors are **exceptions**. `raise` throws one; `try`/`except` catches it:

```python
class TaskNotFound(Exception):       # your own exception type
    pass


def find(tasks: list[dict], task_id: int) -> dict:
    for task in tasks:
        if task["id"] == task_id:
            return task
    raise TaskNotFound(task_id)


try:
    find([], 7)
except TaskNotFound:
    print("no such task")            # runs because find raised
finally:
    print("checked")                 # always runs, error or not
```

An exception that nobody catches stops the program (in a web app, the request) with a traceback. FastAPI's `HTTPException` (lesson 6) is an exception that FastAPI catches and turns into an error response.

## with: setup and cleanup

`with` runs a block between a setup and a guaranteed cleanup:

```python
with open("tasks.json") as f:     # opens the file and names it f
    data = f.read()
# here the file is closed, even if the block raised an exception
```

Database sessions (lesson 9) are used the same way: `with Session(engine) as session:`.

## Decorators

A line starting with `@` above a `def` is a **decorator**: it hands the function to something else, which can register it or wrap it. When you write

```python
@app.get("/tasks")
def list_tasks():
    ...
```

FastAPI records "for `GET /tasks`, call `list_tasks`". You won't need to write decorators, only use them.

## Small but common

- **lambda** is a one-line, unnamed function, mostly used as a sort key: `sorted(tasks, key=lambda t: t["priority"])` sorts tasks by their priority.
- **yield** inside a function makes it hand out a value and pause there; the code after `yield` runs later. FastAPI uses this for setup and cleanup around a request (lesson 8).
- **assert** checks that something is true and fails loudly if not: `assert len(tasks) == 3`. Tests are written with it (lesson 10).
- **async def / await** mark functions that wait for slow input and output without blocking (lessons 3 and 13).
- **Dates**: `from datetime import date, datetime`, then `date(2026, 11, 20)`, `datetime.now()`, and `date.fromisoformat("2026-11-20")` to parse text.

> [!plain] In plain English
> Python code is indented blocks of statements. Data lives in variables, lists (`[ ]`), dicts (`{ }` of key: value) and objects of classes. Type hints after a colon describe what a value should be, and FastAPI uses them to check incoming data.

## Common mistakes

> [!mistake] Forgetting the colon or the indentation
> `if`, `for`, `def`, `class`, `with` and `try` lines end with `:`, and the next line is indented. Missing either is a syntax error.

> [!mistake] `=` versus `==`
> `=` assigns; `==` compares. `if status = "done":` is a syntax error.

> [!mistake] Square brackets on a key that might be missing
> `task["assignee"]` raises `KeyError` when the key is absent. Use `task.get("assignee")` when missing is normal.

:::quiz
q: What does `print(f"{2 + 3} tasks")` print?
- {2 + 3} tasks
+ 5 tasks
- 2 + 3 tasks
- an error
why: An f-string evaluates each `{expression}` and inserts the result.
:::

:::quiz
q: `task = {"id": 1}`. What does `task.get("status", "todo")` return?
- None
- a KeyError
+ "todo"
- "status"
why: `.get` returns the default when the key is missing.
:::

:::quiz
q: Which line defines a parameter `limit` that's optional and defaults to 20?
- `def f(limit = int):`
+ `def f(limit: int = 20):`
- `def f(int limit = 20):`
- `def f(limit -> 20):`
why: The type hint goes after a colon, the default after `=`.
:::

:::quiz
q: What does `[t * 10 for t in [1, 2, 3] if t > 1]` produce?
- [10, 20, 30]
+ [20, 30]
- [2, 3]
- 50
why: The `if` keeps 2 and 3; each is multiplied by 10.
:::

:::quiz
q: In a method, what is `self`?
- the class itself
+ the instance the method was called on
- the parent class
- a keyword that must be passed explicitly by the caller
why: `t.finish()` calls `Task.finish(t)`: `self` is `t`.
:::

:::exercise
id: py-predict-fstring
level: 1
title: "Predict: an f-string"
mode: answer
---
What does this print?

```python
name = "Ana"
open_count = 3
print(f"{name} has {open_count} open tasks")
```
---answer
Ana has 3 open tasks
---solution
Ana has 3 open tasks
:::

:::exercise
id: py-predict-list
level: 1
title: "Predict: append and index"
mode: answer
---
What does this print?

```python
tasks = ["design", "build", "test"]
tasks.append("ship")
print(len(tasks), tasks[-1])
```
---answer
4 ship
---solution
4 ship
---explain
`append` adds to the end, so there are 4 items and the last (`[-1]`) is `ship`. `print` separates its arguments with a space.
:::

:::exercise
id: py-predict-dict
level: 2
title: "Predict: dict lookups"
mode: answer
---
What does this print?

```python
task = {"id": 7, "title": "Write docs"}
task["status"] = "doing"
print(task.get("assignee", "nobody"), task["status"], len(task))
```
---answer
nobody doing 3
---solution
nobody doing 3
---explain
`assignee` is missing, so `.get` returns the default. Setting `status` added a third key.
:::

:::exercise
id: py-predict-comprehension
level: 2
title: "Predict: a comprehension"
mode: answer
---
What does this print?

```python
tasks = [
    {"title": "A", "status": "done"},
    {"title": "B", "status": "todo"},
    {"title": "C", "status": "doing"},
]
print([t["title"] for t in tasks if t["status"] != "done"])
```
---answer
['B', 'C']
---answer
["B", "C"]
---solution
['B', 'C']
---explain
Python prints a list of strings with single quotes: `['B', 'C']`.
:::

:::exercise
id: py-predict-except
level: 2
title: "Predict: try and except"
mode: answer
---
What does this print? (Two lines; type them separated by a space.)

```python
task = {"id": 1}
try:
    print(task["status"])
except KeyError:
    print("missing")
print("after")
```
---answer
missing after
---solution
missing after
---explain
`task["status"]` raises `KeyError` before anything is printed; the `except` block prints `missing`, then the program continues with `after`.
:::

:::exercise
id: py-function
level: 2
title: A function with a default
mode: code
lang: python
file: keys.py
---
Write `task_key(task_id: int, prefix: str = "TB") -> str` that returns the prefix, a hyphen and the id, using an f-string (so `task_key(42)` returns `"TB-42"`).
---starter
# task_key goes here
---hint
The lesson's "Functions and type hints" section has this exact shape.
---rule
def\s+task_key\(\s*task_id\s*:\s*int\s*,\s*prefix\s*:\s*str\s*=\s*["']TB["']\s*\)\s*->\s*str\s*:
The signature, with hints and the default
---rule
return\s+f["']\{prefix\}-\{task_id\}["']
Return `f"{prefix}-{task_id}"`
---solution
def task_key(task_id: int, prefix: str = "TB") -> str:
    return f"{prefix}-{task_id}"
:::

:::exercise
id: py-filter
level: 2
title: Filter with a comprehension
mode: code
lang: python
file: filters.py
---
Write `open_tasks(tasks: list[dict]) -> list[dict]` that returns, using a list comprehension, the tasks whose `"status"` is not `"done"`.
---starter
# open_tasks goes here
---rule
def\s+open_tasks\(\s*tasks\s*:\s*list\[\s*dict\s*\]\s*\)\s*->\s*list\[\s*dict\s*\]\s*:
The signature
---rule
return\s+\[\s*(\w+)\s+for\s+\1\s+in\s+tasks\s+if\s+\1\[\s*["']status["']\s*\]\s*!=\s*["']done["']\s*\]
A comprehension that keeps tasks not done
---solution
def open_tasks(tasks: list[dict]) -> list[dict]:
    return [t for t in tasks if t["status"] != "done"]
:::

:::exercise
id: py-class
level: 3
title: A Task class
mode: code
lang: python
file: task.py
---
Write `class Task` whose `__init__(self, title: str, status: str = "todo")` stores both values as attributes `self.title` and `self.status`, and a method `finish(self) -> None` that sets `self.status` to `"done"`.
---starter
# class Task goes here
---rule
class\s+Task\s*:
`class Task:`
---rule
def\s+__init__\(\s*self\s*,\s*title\s*:\s*str\s*,\s*status\s*:\s*str\s*=\s*["']todo["']\s*\)\s*:
`__init__` with hints and a default
---rule
self\.title\s*=\s*title
Store the title
---rule
self\.status\s*=\s*status
Store the status
---rule
def\s+finish\(\s*self\s*\)\s*->\s*None\s*:\s*\n\s+self\.status\s*=\s*["']done["']
`finish` sets the status to done
---solution
class Task:
    def __init__(self, title: str, status: str = "todo"):
        self.title = title
        self.status = status

    def finish(self) -> None:
        self.status = "done"
:::

:::exercise
id: py-raise
level: 3
title: Raise your own exception
mode: code
lang: python
file: lookup.py
---
Define `class TaskNotFound(Exception)` (its body can be `pass`). Then write `find(tasks: list[dict], task_id: int) -> dict` that loops over `tasks`, returns the task whose `"id"` equals `task_id`, and raises `TaskNotFound(task_id)` after the loop when none matched.
---starter
# TaskNotFound and find go here
---rule
class\s+TaskNotFound\(\s*Exception\s*\)\s*:
The exception class
---rule
def\s+find\(\s*tasks\s*:\s*list\[\s*dict\s*\]\s*,\s*task_id\s*:\s*int\s*\)\s*->\s*dict\s*:
The signature
---rule
for\s+(\w+)\s+in\s+tasks\s*:\s*\n\s+if\s+\1\[\s*["']id["']\s*\]\s*==\s*task_id\s*:\s*\n\s+return\s+\1
Return the matching task
---rule
\n\s+raise\s+TaskNotFound\(\s*task_id\s*\)
Raise when nothing matched
---solution
class TaskNotFound(Exception):
    pass


def find(tasks: list[dict], task_id: int) -> dict:
    for task in tasks:
        if task["id"] == task_id:
            return task
    raise TaskNotFound(task_id)
:::

:::exercise
id: proj-fa-00-counts
level: 2
title: "Project 1: count the board"
mode: code
lang: python
file: stats.py
path: app/stats.py
---
Taskboard's dashboard shows how many tasks are in each column. Write `count_by_status(tasks: list[dict]) -> dict[str, int]` that starts from `counts = {"todo": 0, "doing": 0, "done": 0}`, loops over the tasks adding 1 to `counts[task["status"]]`, and returns `counts`.
---starter
# count_by_status goes here
---hint
`counts[task["status"]] += 1` adds one to the entry for that task's status.
---rule
def\s+count_by_status\(\s*tasks\s*:\s*list\[\s*dict\s*\]\s*\)\s*->\s*dict\[\s*str\s*,\s*int\s*\]\s*:
The signature
---rule
counts\s*=\s*\{\s*["']todo["']\s*:\s*0\s*,\s*["']doing["']\s*:\s*0\s*,\s*["']done["']\s*:\s*0\s*\}
Start every column at 0
---rule
for\s+(\w+)\s+in\s+tasks\s*:\s*\n\s+counts\[\s*\1\[\s*["']status["']\s*\]\s*\]\s*\+=\s*1
Count each task in its column
---rule
return\s+counts
Return the counts
---solution
def count_by_status(tasks: list[dict]) -> dict[str, int]:
    counts = {"todo": 0, "doing": 0, "done": 0}
    for task in tasks:
        counts[task["status"]] += 1
    return counts
:::

:::exercise
id: proj-fa-00-next-id
level: 3
title: "Project 1b: the next task id"
mode: code
lang: python
file: stats.py
path: app/ids.py
---
New tasks need an id one higher than the largest existing one. Write `next_id(tasks: list[dict]) -> int` that returns `max((t["id"] for t in tasks), default=0) + 1`, so an empty board starts at 1.
---starter
# next_id goes here
---rule
def\s+next_id\(\s*tasks\s*:\s*list\[\s*dict\s*\]\s*\)\s*->\s*int\s*:
The signature
---rule
max\(\s*\(\s*(\w+)\[\s*["']id["']\s*\]\s+for\s+\1\s+in\s+tasks\s*\)\s*,\s*default\s*=\s*0\s*\)\s*\+\s*1
`max((… for t in tasks), default=0) + 1`
---solution
def next_id(tasks: list[dict]) -> int:
    return max((t["id"] for t in tasks), default=0) + 1
:::
