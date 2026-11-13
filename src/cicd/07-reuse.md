---
id: cicd-reuse
title: Reusable workflows & pipeline hygiene
summary: Reusable workflows with workflow_call inputs, secrets and outputs; composite actions; concurrency to cancel stale runs; path-based jobs in monorepos; required status checks and merge queues; Dependabot for dependencies and actions; release automation from tags; and speeding up slow pipelines.
minutes: 35
---
## Don't copy-paste pipelines

Ten services with ten nearly identical `ci.yml` files means ten places to fix every change. GitHub Actions has two reuse mechanisms:

| | Reusable workflow | Composite action |
|---|---|---|
| Reuses | whole **jobs** | a sequence of **steps** |
| Defined in | `.github/workflows/x.yml` with `on: workflow_call` | `action.yml` with `runs: using: composite` |
| Called with | `jobs.<id>.uses: org/repo/.github/workflows/x.yml@v1` | `steps[*].uses: org/repo/path@v1` |
| Can choose runners, use environments, secrets | yes | no (runs inside the caller's job) |

## Reusable workflows

```yaml title=.github/workflows/python-ci.yml (in acme/ci-templates)
name: Python CI

on:
  workflow_call:
    inputs:
      python-version:
        type: string
        default: "3.12"
      working-directory:
        type: string
        default: "."
    secrets:
      CODECOV_TOKEN:
        required: false
    outputs:
      coverage:
        value: ${{ jobs.test.outputs.coverage }}

jobs:
  test:
    runs-on: ubuntu-latest
    outputs:
      coverage: ${{ steps.cov.outputs.percent }}
    defaults:
      run:
        working-directory: ${{ inputs.working-directory }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ inputs.python-version }}
          cache: pip
      - run: pip install -r requirements.txt
      - id: cov
        run: |
          pytest --cov --cov-report=term | tee out.txt
          echo "percent=$(grep TOTAL out.txt | awk '{print $NF}')" >> "$GITHUB_OUTPUT"
```

Calling it from a service repository:

```yaml title=.github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  ci:
    uses: acme/ci-templates/.github/workflows/python-ci.yml@v1
    with:
      python-version: "3.13"
    secrets: inherit                 # or pass them explicitly: secrets: { CODECOV_TOKEN: ... }

  report:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - run: echo "Coverage ${{ needs.ci.outputs.coverage }}"
```

Version reusable workflows like any dependency: callers pin `@v1` (or a SHA), and you release changes deliberately.

## Composite actions

For a few steps shared across jobs:

```yaml title=.github/actions/setup-app/action.yml
name: Set up app
description: Install toolchain and dependencies
inputs:
  node-version:
    default: "20"
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: npm
    - run: npm ci
      shell: bash                   # required for run steps in composite actions
```

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-app       # local action: path in this repo
    with:
      node-version: "22"
  - run: npm test
```

## Concurrency: stop wasting runners

Push three commits to a PR in a minute and three full CI runs start. Only the last one matters:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Runs in the same group are serialized; with `cancel-in-progress: true`, a new run cancels the older one. Use `true` for CI on branches and PRs, `false` for deployments.

## Monorepos: run only what changed

`paths` filters work at the workflow level. To decide **per job**, detect changes and use outputs:

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      api: ${{ steps.filter.outputs.api }}
      web: ${{ steps.filter.outputs.web }}
    steps:
      - uses: actions/checkout@v4
      - id: filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            api:
              - 'services/api/**'
            web:
              - 'apps/web/**'

  api:
    needs: changes
    if: needs.changes.outputs.api == 'true'
    uses: ./.github/workflows/python-ci.yml
    with:
      working-directory: services/api
```

## Protecting main

- **Required status checks** in branch protection (or rulesets) block merging until named jobs pass. Name jobs stably: renaming a job silently changes the check name.
- **Merge queues** test each PR against the latest `main` plus the PRs ahead of it before merging, so two individually green PRs can't break `main` together. Workflows must also trigger on `merge_group`.
- Require **up-to-date** branches or a merge queue; otherwise "green on the PR" doesn't mean "green after merge".

## Keeping dependencies fresh: Dependabot

```yaml title=.github/dependabot.yml
version: 2
updates:
  - package-ecosystem: pip
    directory: "/"
    schedule:
      interval: weekly
    groups:
      minor-and-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions       # keeps pinned action SHAs and versions current
    directory: "/"
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: "/"
    schedule:
      interval: weekly
```

Dependabot opens PRs; your CI tests them. Grouping reduces PR noise. Renovate is a more configurable alternative.

## Releases from tags

```yaml
on:
  push:
    tags: ["v*.*.*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make dist
      - run: gh release create "$GITHUB_REF_NAME" dist/* --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
```

Tools like **release-please** go further: they read conventional commits, keep a release PR with the next version and changelog up to date, and tag the release when you merge it.

## When CI gets slow

A 40-minute pipeline means developers context-switch, batch changes and skip running it. Usual fixes, roughly in order of payoff:

1. **Cache** dependencies and Docker layers.
2. **Parallelize**: split lint, unit and integration jobs; shard test suites across a matrix (`pytest --splits 4 --group ${{ matrix.shard }}`).
3. **Skip** work that can't be affected: path filters, `concurrency` cancellation.
4. **Fail fast**: cheap checks first, `--maxfail`.
5. **Bigger runners** for CPU-bound builds; they often cost less overall because they finish sooner.
6. Move slow end-to-end suites to a merge queue or nightly run, keeping PR feedback quick.

:::quiz
q: What's the key difference between a reusable workflow and a composite action?
+ a reusable workflow provides whole jobs (own runners, environments); a composite action provides steps that run inside the caller's job
- composite actions can't take inputs
- reusable workflows can't be versioned
- composite actions run in parallel
why: workflow_call reuses jobs; composite actions reuse steps.
:::

:::quiz
q: Which concurrency setting fits PR CI?
+ group per workflow and ref, with cancel-in-progress: true
- no concurrency at all
- cancel-in-progress: false
- one global group for the whole repository
why: Newer pushes supersede older runs on the same branch.
:::

:::quiz
q: What problem does a merge queue solve?
- slow runners
+ two PRs that pass individually but break main when combined
- secret leakage
- flaky tests
why: The queue tests each PR on top of the latest main plus the PRs ahead of it.
:::

:::quiz
q: In a composite action, what must every `run` step specify?
- `id`
+ `shell`
- `name`
- `if`
why: Composite actions don't inherit a default shell, so `shell: bash` is required.
:::

:::exercise
id: gr-call
level: 2
title: Call a reusable workflow
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Replace the job's steps: the `ci` job should **call** `acme/ci-templates/.github/workflows/python-ci.yml@v1`, passing the input `python-version: "3.13"` and inheriting secrets.
---starter
name: CI
on: [push, pull_request]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest
---rule
ci:\s*\n\s{4}uses:\s*acme/ci-templates/\.github/workflows/python-ci\.yml@v1
`jobs.ci.uses: acme/ci-templates/.github/workflows/python-ci.yml@v1`
---rule
with:\s*\n\s+python-version:\s*["']3\.13["']
`with: python-version: "3.13"`
---rule
secrets:\s*inherit
`secrets: inherit`
---rule
!runs-on:
A calling job has no `runs-on`
---solution
name: CI
on: [push, pull_request]

jobs:
  ci:
    uses: acme/ci-templates/.github/workflows/python-ci.yml@v1
    with:
      python-version: "3.13"
    secrets: inherit
:::

:::exercise
id: gr-define
level: 3
title: Make a workflow reusable
mode: code
lang: yaml
file: .github/workflows/node-ci.yml
---
Make this workflow callable from other workflows with a `string` input `node-version` (default `"20"`), and use that input in `setup-node`.
---starter
name: Node CI

on:
  push:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci && npm test
---rule
on:\s*\n\s+workflow_call:\s*\n\s+inputs:\s*\n\s+node-version:
`on: workflow_call: inputs: node-version`
---rule
node-version:\s*\n\s+type:\s*string|node-version:\s*\n\s+default:\s*["']20["']\s*\n\s+type:\s*string
`type: string`
---rule
default:\s*["']20["']
`default: "20"`
---rule
node-version:\s*\$\{\{\s*inputs\.node-version\s*\}\}
`node-version: ${{ inputs.node-version }}`
---solution
name: Node CI

on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: "20"

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
      - run: npm ci && npm test
:::

:::exercise
id: gr-composite
level: 3
title: A composite action
mode: code
lang: yaml
file: .github/actions/setup-app/action.yml
---
Write a composite action named `Set up app` that runs `actions/setup-python@v5` with Python `"3.12"` and pip caching, then runs `pip install -r requirements.txt` with `shell: bash`.
---starter
name: Set up app
description: Python toolchain and dependencies
---rule
runs:\s*\n\s+using:\s*["']?composite["']?
`runs: using: composite`
---rule
uses:\s*actions/setup-python@v5
`actions/setup-python@v5`
---rule
python-version:\s*["']3\.12["']
Python `"3.12"`
---rule
cache:\s*["']?pip["']?
pip caching
---rule
run:\s*pip install -r requirements\.txt\s*\n\s+shell:\s*bash|shell:\s*bash\s*\n\s+run:\s*pip install -r requirements\.txt
`pip install` with `shell: bash`
---solution
name: Set up app
description: Python toolchain and dependencies
runs:
  using: composite
  steps:
    - uses: actions/setup-python@v5
      with:
        python-version: "3.12"
        cache: pip
    - run: pip install -r requirements.txt
      shell: bash
:::

:::exercise
id: gr-cancel
level: 1
title: Cancel superseded runs
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Add a top-level concurrency block with group `ci-${{ github.workflow }}-${{ github.ref }}` that cancels in-progress runs.
---starter
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
---rule
^concurrency:\s*\n\s+group:\s*ci-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}
The concurrency group
---rule
cancel-in-progress:\s*true
`cancel-in-progress: true`
---solution
name: CI
on: [push, pull_request]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
:::

:::exercise
id: gr-dependabot
level: 2
title: Dependabot for actions and npm
mode: code
lang: yaml
file: .github/dependabot.yml
---
Write a `dependabot.yml` (version 2) with two weekly update entries for directory `"/"`: ecosystem `npm` and ecosystem `github-actions`.
---starter
# Dependabot configuration
---rule
^version:\s*2\s*$
`version: 2`
---rule
^updates:
`updates:`
---rule
package-ecosystem:\s*["']?npm["']?
An `npm` entry
---rule
package-ecosystem:\s*["']?github-actions["']?
A `github-actions` entry
---rule
directory:\s*["']/["']
`directory: "/"`
---rule
schedule:\s*\n\s+interval:\s*["']?weekly["']?[\s\S]*schedule:\s*\n\s+interval:\s*["']?weekly["']?
Both weekly
---solution
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
:::

:::exercise
id: gr-release
level: 3
title: Release on a version tag
mode: code
lang: yaml
file: .github/workflows/release.yml
---
Trigger on pushed tags matching `v*.*.*`, give the token `contents: write`, and in a job `release` (ubuntu-latest) check out, run `make dist`, then run `gh release create "$GITHUB_REF_NAME" dist/* --generate-notes` with `GH_TOKEN: ${{ github.token }}` in its env.
---starter
name: Release
---rule
on:\s*\n\s+push:\s*\n\s+tags:\s*(\[\s*["']v\*\.\*\.\*["']\s*\]|\n\s+-\s*["']v\*\.\*\.\*["'])
Tags `v*.*.*`
---rule
permissions:\s*\n\s+contents:\s*write
`contents: write`
---rule
release:\s*\n\s+runs-on:\s*ubuntu-latest
Job `release` on `ubuntu-latest`
---rule
run:\s*make dist
`make dist`
---rule
run:\s*gh release create\s+"\$GITHUB_REF_NAME"\s+dist/\*\s+--generate-notes
`gh release create "$GITHUB_REF_NAME" dist/* --generate-notes`
---rule
GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}
`GH_TOKEN: ${{ github.token }}`
---solution
name: Release

on:
  push:
    tags: ["v*.*.*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make dist
      - run: gh release create "$GITHUB_REF_NAME" dist/* --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
:::

:::exercise
id: gr-merge-group
level: 2
title: Ready for the merge queue
mode: answer
---
Your repository enables a merge queue, but queued PRs hang waiting for the CI check. Which event must the CI workflow also trigger on?
---answer
merge_group
---solution
merge_group
:::
