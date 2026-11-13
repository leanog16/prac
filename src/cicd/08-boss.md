---
id: cicd-boss
title: Boss round: pipelines end to end
summary: Design and repair complete pipelines: a full CI/CD workflow for a containerized API, broken YAML and misconfigured triggers, leaked and over-privileged credentials, a pipeline that's too slow, and deployment incidents.
minutes: 60
---
## A pipeline troubleshooting playbook

| Symptom | Check | Usual cause |
|---|---|---|
| Workflow never starts | `on:` filters, file location, YAML validity | wrong branch name, `paths` filter, file not in `.github/workflows/`, invalid YAML (tabs, bad indentation) |
| Job skipped | `if:` and `needs` | a needed job failed or was skipped; `if` expression false |
| `Resource not accessible by integration` | `permissions:` | the token lacks the scope (e.g. `packages: write`, `pull-requests: write`) |
| Secret is empty | event type, environment | fork PR, Dependabot PR (uses Dependabot secrets), missing `environment:` for an environment secret |
| `Could not assume role` with OIDC | `id-token: write`, trust policy `sub` | missing permission, branch/environment doesn't match the trust condition |
| Works locally, fails in CI | runner image, versions, env vars | unpinned tool versions, missing service, timezone, case-sensitive filesystem |
| Cache never hits | the cache key | key includes something that changes every run (timestamp, SHA) |
| CI takes 40 minutes | timing per step | no caching, serial jobs, huge test suite on one runner, no path filters |
| Deploy "succeeded" but site is down | smoke tests, health checks | no post-deploy verification; `--wait` / stability checks missing |

:::exercise
id: cb-full-pipeline
level: 4
title: The whole pipeline
mode: code
lang: yaml
file: .github/workflows/pipeline.yml
---
Write a workflow `Pipeline` that runs on pushes to `main` and on pull requests, with workflow-level permissions `contents: read`, `packages: write` and `id-token: write`, and these jobs:

- **`test`** (ubuntu-latest): checkout, `actions/setup-python@v5` with `"3.12"` and pip cache, `pip install -r requirements.txt`, `pytest`.
- **`image`** (needs `test`): checkout, `docker/setup-buildx-action@v3`, `docker/login-action@v3` to `ghcr.io` (actor + `GITHUB_TOKEN`), then `docker/build-push-action@v6` pushing `ghcr.io/acme/api:${{ github.sha }}` with the `gha` cache. It must run **only on pushes** (not PRs).
- **`deploy`** (needs `image`): environment `production`, runs `./deploy.sh ghcr.io/acme/api:${{ github.sha }}`.
---starter
name: Pipeline
---rule
on:\s*\n(\s+.*\n)*?\s+push:\s*\n\s+branches:\s*\[\s*["']?main["']?\s*\]
`push` to `main`
---rule
^\s+pull_request:
`pull_request`
---rule
^permissions:\s*\n((\s+.*\n)*?\s+contents:\s*read)
`contents: read`
---rule
^permissions:\s*\n(\s+.*\n)*?\s+packages:\s*write
`packages: write`
---rule
^permissions:\s*\n(\s+.*\n)*?\s+id-token:\s*write
`id-token: write`
---rule
test:\s*\n\s+runs-on:\s*ubuntu-latest[\s\S]*?setup-python@v5[\s\S]*?python-version:\s*["']3\.12["'][\s\S]*?cache:\s*pip[\s\S]*?pip install -r requirements\.txt[\s\S]*?run:\s*pytest
`test`: Python 3.12 with pip cache, install, pytest
---rule
image:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*\[?\s*test\s*\]?
`image` needs `test`
---rule
image:\s*\n(\s{4}.*\n)*?\s{4}if:\s*(\$\{\{\s*)?github\.event_name\s*==\s*'push'
`image` only on pushes
---rule
docker/setup-buildx-action@v3[\s\S]*docker/login-action@v3[\s\S]*registry:\s*ghcr\.io[\s\S]*docker/build-push-action@v6
Buildx, GHCR login, then build-push
---rule
tags:\s*ghcr\.io/acme/api:\$\{\{\s*github\.sha\s*\}\}
Tag with the SHA
---rule
push:\s*true
Push the image
---rule
cache-from:\s*type=gha[\s\S]*cache-to:\s*type=gha
`gha` cache
---rule
deploy:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*\[?\s*image\s*\]?
`deploy` needs `image`
---rule
deploy:\s*\n(\s{4}.*\n)*?\s{4}environment:\s*(production|\n\s+name:\s*production)
`deploy` uses environment `production`
---rule
run:\s*\./deploy\.sh\s+ghcr\.io/acme/api:\$\{\{\s*github\.sha\s*\}\}
Deploy the exact image
---solution
name: Pipeline

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt
      - run: pytest

  image:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/acme/api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: image
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh ghcr.io/acme/api:${{ github.sha }}
:::

:::exercise
id: cb-never-runs
level: 3
title: The workflow that never runs
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
The team pushes to `main` and opens PRs against `main`, but this workflow never triggers. Fix the triggers (two mistakes) without removing any intended event.
---starter
name: CI
on:
  push:
    branches: [master]
  pull-request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
---rule
push:\s*\n\s+branches:\s*\[\s*["']?main["']?\s*\]
Pushes to `main`
---rule
^\s+pull_request:\s*\n\s+branches:\s*\[\s*["']?main["']?\s*\]
`pull_request` (underscore) targeting `main`
---rule
!pull-request:
No `pull-request` (hyphen)
---rule
!master
No `master`
---solution
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
:::

:::exercise
id: cb-leaky
level: 4
title: The over-privileged, leaky workflow
mode: code
lang: yaml
file: .github/workflows/deploy.yml
---
A security review flagged this workflow. Fix all of it: use **OIDC** with role `arn:aws:iam::123456789012:role/deploy` instead of stored keys; set permissions to only `id-token: write` and `contents: read`; stop printing the API key (remove that step); pass `API_KEY` to `deploy.sh` through `env:` instead of `${{ }}` in the script; and pin `some-org/notify-action` to the SHA `3b1f9f1c2d4e5f60718293a4b5c6d7e8f9a0b1c2` instead of `@main`.
---starter
name: Deploy
on:
  push:
    branches: [main]

permissions: write-all

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - run: echo "Using key ${{ secrets.API_KEY }}"
      - run: ./deploy.sh --api-key ${{ secrets.API_KEY }}
      - uses: some-org/notify-action@main
---rule
!write-all
No `write-all`
---rule
^permissions:\s*\n(\s+.*\n)*?\s+id-token:\s*write
`id-token: write`
---rule
^permissions:\s*\n(\s+.*\n)*?\s+contents:\s*read
`contents: read`
---rule
role-to-assume:\s*arn:aws:iam::123456789012:role/deploy
OIDC role
---rule
!secrets\.AWS_
No stored AWS keys
---rule
!echo[^\n]*API_KEY
Don't print the key
---rule
!run:[^\n]*\$\{\{\s*secrets\.API_KEY
No secret interpolated into a script
---rule
API_KEY:\s*\$\{\{\s*secrets\.API_KEY\s*\}\}
Pass it through `env:`
---rule
run:\s*\./deploy\.sh\s+--api-key\s+"?\$API_KEY"?
`./deploy.sh --api-key "$API_KEY"`
---rule
uses:\s*some-org/notify-action@3b1f9f1c2d4e5f60718293a4b5c6d7e8f9a0b1c2
Pinned by SHA
---solution
name: Deploy
on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy
          aws-region: us-east-1
      - run: ./deploy.sh --api-key "$API_KEY"
        env:
          API_KEY: ${{ secrets.API_KEY }}
      - uses: some-org/notify-action@3b1f9f1c2d4e5f60718293a4b5c6d7e8f9a0b1c2
:::

:::exercise
id: cb-slow
level: 4
title: Make it fast
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
This CI takes 35 minutes. Apply four fixes: cancel superseded runs per ref (`concurrency` group `ci-${{ github.ref }}` with cancel-in-progress); enable npm caching in `setup-node`; split lint into its own `lint` job so it runs **in parallel** with tests (checkout, setup-node 20 with npm cache, `npm ci`, `npm run lint`); and shard the tests over a matrix `shard: [1, 2, 3, 4]` running `npx jest --shard=${{ matrix.shard }}/4`.
---starter
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npx jest
---rule
^concurrency:\s*\n\s+group:\s*ci-\$\{\{\s*github\.ref\s*\}\}\s*\n\s+cancel-in-progress:\s*true
Concurrency with cancellation
---rule
cache:\s*["']?npm["']?[\s\S]*cache:\s*["']?npm["']?
npm caching in both jobs
---rule
^\s{2}lint:\s*\n(\s{4}.*\n)*?\s{4}runs-on:\s*ubuntu-latest
A separate `lint` job
---rule
lint:\s*\n(\s{4}.*\n)*?[\s\S]*?run:\s*npm run lint
`lint` runs `npm run lint`
---rule
test:\s*\n(\s{4}.*\n)*?\s{4}strategy:\s*\n\s+matrix:\s*\n\s+shard:\s*\[\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*\]
`test` matrix `shard: [1, 2, 3, 4]`
---rule
run:\s*npx jest --shard=\$\{\{\s*matrix\.shard\s*\}\}/4
`npx jest --shard=${{ matrix.shard }}/4`
---rule
!test:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*\[?\s*lint
Lint doesn't block the tests
---solution
name: CI
on: [push, pull_request]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx jest --shard=${{ matrix.shard }}/4
:::

:::exercise
id: cb-cache-miss
level: 3
title: The cache that never hits
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Every run reports "Cache not found". Fix the key so it changes only when `poetry.lock` changes: `poetry-${{ runner.os }}-${{ hashFiles('poetry.lock') }}`.
---starter
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
        with:
          path: ~/.cache/pypoetry
          key: poetry-${{ runner.os }}-${{ github.sha }}
      - run: poetry install && poetry run pytest
---rule
key:\s*poetry-\$\{\{\s*runner\.os\s*\}\}-\$\{\{\s*hashFiles\(\s*'poetry\.lock'\s*\)\s*\}\}
Key on `hashFiles('poetry.lock')`
---rule
!key:[^\n]*github\.sha
No SHA in the key
---solution
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
        with:
          path: ~/.cache/pypoetry
          key: poetry-${{ runner.os }}-${{ hashFiles('poetry.lock') }}
      - run: poetry install && poetry run pytest
:::

:::exercise
id: cb-oidc-fail
level: 3
title: Predict: OIDC from a PR
mode: answer
---
A role's trust policy allows `sub` = `repo:acme/shop:ref:refs/heads/main`. A workflow triggered by a **pull request** in that repository tries to assume the role (it has `id-token: write`). Does it succeed? Answer `yes` or `no`.
---answer
no
---solution
no
---explain
For pull_request events the `sub` claim is `repo:acme/shop:pull_request`, which doesn't match the condition.
:::

:::exercise
id: cb-rollback
level: 3
title: Incident: bad release
mode: answer
---
A deployment of `api:9c1e2f0` to Kubernetes went out 5 minutes ago and the error rate jumped from 0.1% to 12%. The previous release `api:4b7d1a3` was healthy. Give the single `kubectl` command that returns `deployment/api` to its previous revision.
---answer
kubectl rollout undo deployment/api
---solution
kubectl rollout undo deployment/api
---explain
Roll back first, investigate after. Then fix forward through the normal pipeline.
:::
