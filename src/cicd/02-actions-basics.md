---
id: cicd-actions
title: GitHub Actions basics
summary: Workflows, events, jobs, steps and runners; push, pull_request, schedule and workflow_dispatch triggers with branch and path filters; run steps vs uses steps; checkout; job dependencies with needs; expressions, contexts, if conditions and default shells.
minutes: 35
---
## The pieces

**GitHub Actions** runs automation defined in YAML files under `.github/workflows/` in your repository.

| Term | Is |
|---|---|
| **workflow** | one YAML file: a set of jobs triggered by events |
| **event** | what starts it: a push, a pull request, a schedule, a manual click |
| **job** | a set of steps that runs on **one runner**; jobs run **in parallel** by default |
| **step** | a shell command (`run:`) or a reusable **action** (`uses:`), run in order within a job |
| **runner** | the machine: GitHub-hosted (`ubuntu-latest`, `windows-latest`, `macos-latest`) or self-hosted |
| **action** | a reusable unit, e.g. `actions/checkout@v4`, from the Marketplace or your own repo |

## Your first workflow

```yaml title=.github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r requirements.txt
      - run: pytest -q
```

- `on:` lists the triggering events.
- Each job needs `runs-on:` and `steps:`.
- **`actions/checkout`** clones your repository onto the runner. The runner starts **empty**, so almost every job begins with it.
- `with:` passes inputs to an action.
- A step that exits non-zero **fails the job**, and the remaining steps are skipped.

## Triggers

```yaml
on:
  push:
    branches: [main, "release/**"]
    tags: ["v*"]                      # pushes of tags like v1.2.0
    paths-ignore: ["docs/**", "**.md"]
  pull_request:
    branches: [main]                  # PRs *targeting* main
    paths: ["src/**", "pyproject.toml"]
  schedule:
    - cron: "0 6 * * 1-5"             # 06:00 UTC, Monday to Friday
  workflow_dispatch:                  # a "Run workflow" button in the UI
    inputs:
      environment:
        type: choice
        options: [staging, production]
```

- `branches` under `pull_request` filters by the **base** (target) branch.
- `paths` / `paths-ignore` skip workflows when only unrelated files changed. Watch out: a **required** check that's skipped by a path filter can block merging.
- Schedules use **UTC** cron, run on the default branch, and can be delayed at busy times.
- `workflow_dispatch` inputs are available as `${{ inputs.environment }}`.

## Multi-line commands and shells

```yaml
- name: Lint and test
  run: |
    ruff check .
    pytest -q --maxfail=1
  working-directory: backend
  env:
    PYTHONUNBUFFERED: "1"
```

`run: |` is a YAML block: each line is a shell command, run with `bash -e` on Linux, so the first failing line stops the step. `name:` labels the step in the UI.

## Jobs in parallel and in sequence

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test

  build:
    needs: [lint, test]               # waits for both to succeed
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make build
```

`lint` and `test` run at the same time on separate runners; `build` waits for both. If either fails, `build` is skipped. Each job gets a **fresh runner**, so files don't carry over between jobs; you pass data with artifacts or outputs (later lessons).

## Expressions and contexts

`${{ ... }}` evaluates an expression. **Contexts** expose information about the run:

| Context | Examples |
|---|---|
| `github` | `github.ref` (`refs/heads/main`), `github.ref_name` (`main`), `github.sha`, `github.event_name`, `github.actor`, `github.repository` |
| `env` | variables set with `env:` |
| `secrets` | `secrets.NPM_TOKEN` |
| `vars` | repository/organization configuration variables |
| `inputs` | `workflow_dispatch` / reusable workflow inputs |
| `matrix`, `needs`, `steps`, `runner`, `job` | covered later |

## Conditions with if

```yaml
deploy:
  needs: build
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  steps:
    - run: ./deploy.sh

notify:
  needs: [build]
  if: failure()                 # only when a needed job failed
  runs-on: ubuntu-latest
  steps:
    - run: ./notify-team.sh
```

Status functions: `success()` (the default), `failure()`, `cancelled()`, and `always()` (run regardless, e.g. for cleanup or uploading test reports). Inside `if:` you can omit the `${{ }}`.

## Environment variables

```yaml
env:                          # workflow level
  NODE_ENV: test
jobs:
  build:
    env:                      # job level
      LOG_LEVEL: debug
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building $GITHUB_SHA on $RUNNER_OS"
        env:                  # step level
          EXTRA: "1"
```

GitHub sets many default variables: `GITHUB_SHA`, `GITHUB_REF_NAME`, `GITHUB_REPOSITORY`, `GITHUB_RUN_NUMBER`, `RUNNER_OS`, `CI=true`. To set a variable for **later steps**, append to the `$GITHUB_ENV` file: `echo "VERSION=1.4.2" >> "$GITHUB_ENV"`.

:::quiz
q: Two jobs in a workflow have no `needs`. How do they run?
- sequentially in file order
+ in parallel on separate runners
- on the same runner, one after the other
- only the first one runs
why: Jobs are parallel by default; use needs to order them.
:::

:::quiz
q: Why does almost every job start with `actions/checkout`?
+ the runner starts without your code; checkout clones the repository
- it installs GitHub's CLI
- it authenticates to GitHub
- it's required syntax
why: Each job gets a fresh, empty runner.
:::

:::quiz
q: `on: pull_request: branches: [main]` triggers for…
- PRs whose source branch is main
+ PRs that target main
- pushes to main
- any PR
why: For pull_request, branches filters the base (target) branch.
:::

:::quiz
q: A cleanup step must run even when earlier steps failed. Which condition?
- `if: success()`
- `if: failure()`
+ `if: always()`
- no condition needed
why: always() runs regardless of earlier failures (and even on cancellation).
:::

:::exercise
id: ga-first
level: 1
title: A first CI workflow
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Write a workflow named `CI` that runs on **pushes to `main`** and on **pull requests**, with one job `test` on `ubuntu-latest` that checks out the code (`actions/checkout@v4`) and runs `make test`.
---starter
name: CI
---rule
^on:\s*\n(\s+.*\n)*?\s+push:\s*\n\s+branches:\s*\[\s*["']?main["']?\s*\]
`push` on `branches: [main]`
---rule
^\s+pull_request:
`pull_request` trigger
---rule
^jobs:\s*\n\s+test:\s*\n\s+runs-on:\s*ubuntu-latest
Job `test` on `ubuntu-latest`
---rule
uses:\s*actions/checkout@v4
Check out the code
---rule
run:\s*make test
Run `make test`
---rule
checkout@v4[\s\S]*make test
Checkout comes before the test
---solution
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
:::

:::exercise
id: ga-triggers
level: 2
title: Triggers with filters
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Make the workflow trigger on: pushes to `main` **ignoring** changes only under `docs/**`; pull requests targeting `main`; every day at **02:00 UTC** on a schedule; and manually from the UI.
---starter
name: CI

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
---rule
^on:
An `on:` block
---rule
push:\s*\n\s+branches:\s*\[\s*["']?main["']?\s*\]\s*\n\s+paths-ignore:\s*\[\s*["']docs/\*\*["']\s*\]|push:\s*\n\s+paths-ignore:\s*\[\s*["']docs/\*\*["']\s*\]\s*\n\s+branches:\s*\[\s*["']?main["']?\s*\]|push:\s*\n\s+branches:\s*\[\s*["']?main["']?\s*\]\s*\n\s+paths-ignore:\s*\n\s+-\s*["']docs/\*\*["']
`push` to `main` with `paths-ignore: ["docs/**"]`
---rule
pull_request:\s*\n\s+branches:\s*\[\s*["']?main["']?\s*\]
`pull_request` targeting `main`
---rule
schedule:\s*\n\s+-\s*cron:\s*["']0 2 \* \* \*["']
`schedule` with `cron: "0 2 * * *"`
---rule
^\s+workflow_dispatch:
`workflow_dispatch`
---solution
name: CI

on:
  push:
    branches: [main]
    paths-ignore: ["docs/**"]
  pull_request:
    branches: [main]
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
:::

:::exercise
id: ga-needs
level: 2
title: Lint and test, then build
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Add a job `build` (on `ubuntu-latest`, checkout then `make build`) that runs only after **both** `lint` and `test` succeed.
---starter
name: CI
on: [push]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make lint
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
---rule
^\s{2}build:\s*\n
A job `build`
---rule
build:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*(\[\s*lint\s*,\s*test\s*\]|\[\s*test\s*,\s*lint\s*\])
`needs: [lint, test]`
---rule
build:[\s\S]*runs-on:\s*ubuntu-latest[\s\S]*actions/checkout@v4[\s\S]*make build
Checks out and runs `make build`
---solution
name: CI
on: [push]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make lint
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make build
:::

:::exercise
id: ga-if-main
level: 3
title: Deploy only from main
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
The `deploy` job must run only for **push** events on the `main` branch (not for pull requests). Add the condition using `github.event_name` and `github.ref`.
---starter
name: CI
on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
---rule
deploy:\s*\n(\s{4}.*\n)*?\s{4}if:\s*(\$\{\{\s*)?(github\.event_name\s*==\s*'push'\s*&&\s*github\.ref\s*==\s*'refs/heads/main'|github\.ref\s*==\s*'refs/heads/main'\s*&&\s*github\.event_name\s*==\s*'push')
`if: github.event_name == 'push' && github.ref == 'refs/heads/main'`
---solution
name: CI
on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
  deploy:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
:::

:::exercise
id: ga-always
level: 2
title: Report even on failure
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Add a final step named `Upload report` that runs `./upload-report.sh` **even if the tests failed**.
---starter
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest --junitxml=report.xml
---rule
-\s*name:\s*Upload report\s*\n\s+if:\s*(\$\{\{\s*)?always\(\)|-\s*name:\s*Upload report\s*\n\s+run:\s*\./upload-report\.sh\s*\n\s+if:\s*(\$\{\{\s*)?always\(\)|-\s*if:\s*(\$\{\{\s*)?always\(\)[^\n]*\n\s+name:\s*Upload report
A step `Upload report` with `if: always()`
---rule
run:\s*\./upload-report\.sh
Runs `./upload-report.sh`
---rule
pytest[\s\S]*upload-report
After the tests
---solution
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest --junitxml=report.xml
      - name: Upload report
        if: always()
        run: ./upload-report.sh
:::

:::exercise
id: ga-dispatch-input
level: 3
title: A manual run with a choice
mode: code
lang: yaml
file: .github/workflows/deploy.yml
---
Make this workflow manually triggerable with a required `choice` input `environment` (options `staging` and `production`), and pass it to the script as `./deploy.sh ${{ inputs.environment }}`.
---starter
name: Deploy

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
---rule
on:\s*\n\s+workflow_dispatch:\s*\n\s+inputs:\s*\n\s+environment:
`workflow_dispatch` → `inputs` → `environment`
---rule
type:\s*choice
`type: choice`
---rule
required:\s*true
`required: true`
---rule
options:\s*\[\s*staging\s*,\s*production\s*\]|options:\s*\n\s+-\s*staging\s*\n\s+-\s*production
`options: [staging, production]`
---rule
run:\s*\./deploy\.sh\s+\$\{\{\s*inputs\.environment\s*\}\}
`./deploy.sh ${{ inputs.environment }}`
---solution
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        required: true
        options: [staging, production]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh ${{ inputs.environment }}
:::

:::exercise
id: ga-github-env
level: 3
title: Pass a value to later steps
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
In the first `run` step, compute `VERSION` as the short commit SHA with `git rev-parse --short HEAD` and append `VERSION=<value>` to `$GITHUB_ENV`, so the next step can use `$VERSION`.
---starter
name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "computing version"
      - run: docker build -t app:$VERSION .
---rule
echo\s+"VERSION=\$\(git rev-parse --short HEAD\)"\s*>>\s*"?\$GITHUB_ENV"?
`echo "VERSION=$(git rev-parse --short HEAD)" >> "$GITHUB_ENV"`
---rule
GITHUB_ENV[\s\S]*docker build -t app:\$VERSION
Set before the build step
---solution
name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "VERSION=$(git rev-parse --short HEAD)" >> "$GITHUB_ENV"
      - run: docker build -t app:$VERSION .
:::

:::exercise
id: ga-ref-name
level: 2
title: Predict: ref vs ref_name
mode: answer
---
A workflow runs for a push to the branch `main`. What is the value of `github.ref`?
---answer
refs/heads/main
---solution
refs/heads/main
---explain
`github.ref` is the full ref; `github.ref_name` is just `main`. Tags look like `refs/tags/v1.2.0`.
:::
