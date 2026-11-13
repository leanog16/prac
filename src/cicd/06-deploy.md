---
id: cicd-deploy
title: Deployment strategies
summary: Recreate, rolling, blue/green and canary deployments; feature flags; zero-downtime database migrations with expand and contract; a staging-then-production pipeline with approvals; deploying to a VM over SSH, to Amazon ECS and to Kubernetes; smoke tests, automatic rollback and GitOps.
minutes: 40
---
> [!project] Taskboard, step 6: staging, then production
> The image exists; now ship it. Taskboard deploys automatically to staging, runs a smoke test, waits for an approval, then deploys the **same** image to production on Amazon ECS with automatic rollback.

## How the new version replaces the old

| Strategy | How | Downtime | Rollback | Cost |
|---|---|---|---|---|
| **Recreate** | stop all old, start all new | yes | redeploy old | none extra |
| **Rolling** | replace instances a few at a time, behind a load balancer | no | roll forward/back gradually | none extra |
| **Blue/green** | run the new version (green) next to the old (blue), switch all traffic at once | no | switch back instantly | double capacity during the switch |
| **Canary** | send a small share of traffic (1%, 10%…) to the new version, watch metrics, then increase | no | shift traffic back | small |

- **Rolling** is the default in Kubernetes Deployments and Amazon ECS services. During a rollout, old and new versions serve traffic **at the same time**, so they must be compatible with each other, with clients and with the database.
- **Blue/green** gives instant, clean rollback, at the price of duplicate infrastructure. It's natural with load balancer target groups or DNS weights.
- **Canary** limits the blast radius: a bad release hurts 5% of users for 10 minutes instead of everyone. It needs good metrics (error rate, latency) and ideally automated analysis that aborts the rollout.

## Feature flags

A **feature flag** wraps new behavior in a runtime switch:

```python
if flags.enabled("new-checkout", user_id=user.id):
    return new_checkout(cart)
return legacy_checkout(cart)
```

Flags separate **deploying** code from **releasing** a feature: merge and deploy dark, enable for staff, then 10% of users, then everyone, and turn it off instantly without a deployment if something breaks. Remove flags once a feature is fully rolled out, or they pile up as technical debt.

## Database changes without downtime

During a rolling or canary deployment, **old and new code run against the same database**. A migration that renames a column breaks the old version instantly. Use **expand and contract** (parallel change) across several releases:

1. **Expand**: add the new column (nullable or with a default). Old code ignores it.
2. **Migrate**: deploy code that writes **both** columns and reads the new one with a fallback; backfill existing rows.
3. **Switch**: deploy code that only uses the new column.
4. **Contract**: drop the old column in a later release, once nothing uses it.

Run migrations as a pipeline step **before** the new application version rolls out, and make each migration backward-compatible with the version still running.

## A staging → production pipeline

```yaml title=.github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false            # never kill a deployment halfway

permissions:
  contents: read
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image: ghcr.io/acme/api:${{ github.sha }}
    steps:
      - uses: actions/checkout@v4
      - run: echo "build, test, push ghcr.io/acme/api:${{ github.sha }}"

  staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: ./deploy.sh staging ${{ needs.build.outputs.image }}
      - run: ./smoke-test.sh https://staging.shop.example.com

  production:
    needs: [build, staging]
    runs-on: ubuntu-latest
    environment:
      name: production                  # required reviewers approve here
      url: https://shop.example.com
    steps:
      - run: ./deploy.sh production ${{ needs.build.outputs.image }}
      - run: ./smoke-test.sh https://shop.example.com
```

The **same image** moves from staging to production. Only the target and its configuration change.

## Deploying to a single VM over SSH

For small apps on one server running Docker Compose:

```yaml
- name: Deploy over SSH
  env:
    SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
    IMAGE: ghcr.io/acme/api:${{ github.sha }}
  run: |
    install -m 600 /dev/null ~/.ssh/id_ed25519
    echo "$SSH_KEY" > ~/.ssh/id_ed25519
    ssh-keyscan -H "${{ vars.DEPLOY_HOST }}" >> ~/.ssh/known_hosts
    ssh deploy@${{ vars.DEPLOY_HOST }} \
      "cd /srv/api && IMAGE=$IMAGE docker compose pull && IMAGE=$IMAGE docker compose up -d --wait"
```

`docker compose up -d --wait` waits for healthchecks, so the step fails if the new container never becomes healthy. Use a dedicated, low-privilege deploy user and a key used for nothing else.

## Deploying to Amazon ECS

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789012:role/github-deploy
    aws-region: eu-west-1
- id: task
  uses: aws-actions/amazon-ecs-render-task-definition@v1
  with:
    task-definition: ecs/task-definition.json
    container-name: api
    image: 123456789012.dkr.ecr.eu-west-1.amazonaws.com/api:${{ github.sha }}
- uses: aws-actions/amazon-ecs-deploy-task-definition@v2
  with:
    task-definition: ${{ steps.task.outputs.task-definition }}
    service: api
    cluster: shop
    wait-for-service-stability: true
```

ECS performs a rolling deployment; with the **deployment circuit breaker** enabled on the service, it rolls back automatically if new tasks keep failing health checks.

## Deploying to Kubernetes

```bash
kubectl set image deployment/api api=ghcr.io/acme/api:3f2c1ab
kubectl rollout status deployment/api --timeout=5m     # fails the step if the rollout stalls
kubectl rollout undo deployment/api                    # back to the previous ReplicaSet
```

Most teams template manifests with **Helm** or **Kustomize**. With **GitOps** (Argo CD, Flux), CI doesn't touch the cluster at all: it commits the new image tag to a config repository, and an agent inside the cluster syncs the cluster to match Git. Git becomes the audit log, and rollback is `git revert`.

## Verify, then roll back fast

- **Smoke tests** right after deploying: hit `/health`, log in, load a key page. A deploy that "succeeded" but serves 500s isn't a success.
- Watch error rates and latency for the first minutes; canary tools (Argo Rollouts, Flagger, AWS CodeDeploy) automate the decision.
- **Rollback** should be one action: redeploy the previous immutable tag, `kubectl rollout undo`, switch blue/green back, or turn off the flag. Practice it before you need it.
- Prefer rolling **forward** with a fix only when the fix is quick and certain; otherwise roll back first and debug calmly.

## Worked example: Taskboard's release with a schema change

The next Taskboard release renames `tasks.assignee` to `tasks.assignee_id`. During the rolling deployment, old and new tasks of the service run side by side for a few minutes. Plan it as expand/contract across **three** releases:

| Release | Migration | Code |
|---|---|---|
| 1.3 | add nullable `assignee_id`, backfill it | writes **both** columns, reads `assignee_id` falling back to `assignee` |
| 1.4 | none | reads and writes only `assignee_id` |
| 1.5 | drop `assignee` | unchanged |

Every release is safe to roll back to the previous one, because the previous code still finds the columns it expects. This is slower than one big change, and it's the price of zero downtime.

## Worked example: what "deploy" actually runs

```yaml
- id: task
  uses: aws-actions/amazon-ecs-render-task-definition@v1
  with:
    task-definition: deploy/taskboard-task.json
    container-name: api
    image: ${{ needs.image.outputs.ref }}           # the exact image CI built
- uses: aws-actions/amazon-ecs-deploy-task-definition@v2
  with:
    task-definition: ${{ steps.task.outputs.task-definition }}
    service: taskboard-api
    cluster: taskboard-staging
    wait-for-service-stability: true                 # fail the job if new tasks don't become healthy
- run: ./scripts/smoke-test.sh https://staging.taskboard.dev
```

> [!plain] In plain English
> Deploying means telling the platform "run this new image instead of the old one", then checking the new version actually works before calling it done.

:::quiz
q: Which strategy gives the fastest, cleanest rollback?
- recreate
- rolling
+ blue/green: switch traffic back to the old environment
- canary at 100%
why: The previous version is still running, so rollback is a traffic switch.
:::

:::quiz
q: Why must database migrations stay backward-compatible during a rolling deployment?
+ old and new application versions run against the same database at the same time
- rolling deployments run migrations twice
- databases can't be changed during deployments
- ORMs require it
why: During the rollout, the old version still serves traffic and must keep working.
:::

:::quiz
q: What do feature flags separate?
+ deploying code from releasing a feature to users
- staging from production
- frontend from backend
- tests from builds
why: Code can ship dark and be enabled (or disabled) at runtime.
:::

:::quiz
q: Why set `cancel-in-progress: false` on a deployment concurrency group?
- to deploy faster
+ so a newer run waits instead of killing a deployment halfway through
- to allow parallel deployments
- because it's required with environments
why: Cancelling mid-deployment can leave an environment half-updated.
:::

:::exercise
id: gd-promote
level: 3
title: Staging, then production
mode: code
lang: yaml
file: .github/workflows/deploy.yml
---
Add two jobs after `build`: `staging` (needs `build`, environment `staging`, runs `./deploy.sh staging`) and `production` (needs `staging`, environment `production`, runs `./deploy.sh production`). Both on `ubuntu-latest`.
---starter
name: Deploy
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make image
---rule
staging:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*\[?\s*build\s*\]?
`staging` needs `build`
---rule
staging:\s*\n(\s{4}.*\n)*?\s{4}environment:\s*staging
`staging` uses environment `staging`
---rule
production:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*(\[\s*)?(build\s*,\s*)?staging
`production` needs `staging`
---rule
production:\s*\n(\s{4}.*\n)*?\s{4}environment:\s*(production|\n\s+name:\s*production)
`production` uses environment `production`
---rule
run:\s*\./deploy\.sh staging
Deploy to staging
---rule
run:\s*\./deploy\.sh production
Deploy to production
---solution
name: Deploy
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make image
  staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: ./deploy.sh staging
  production:
    needs: staging
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: ./deploy.sh production
:::

:::exercise
id: gd-concurrency
level: 2
title: One deployment at a time
mode: code
lang: yaml
file: .github/workflows/deploy.yml
---
Make sure only one run of this workflow deploys at a time **per branch**, using a concurrency group `deploy-${{ github.ref }}`, and that a newer run **waits** rather than cancelling the running one.
---starter
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
---rule
^concurrency:\s*\n\s+group:\s*deploy-\$\{\{\s*github\.ref\s*\}\}
`concurrency.group: deploy-${{ github.ref }}`
---rule
cancel-in-progress:\s*false
`cancel-in-progress: false`
---solution
name: Deploy
on:
  push:
    branches: [main]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
:::

:::exercise
id: gd-ecs
level: 3
title: Roll out to ECS
mode: code
lang: yaml
file: .github/workflows/deploy.yml
---
After the render step (id `task`), add `aws-actions/amazon-ecs-deploy-task-definition@v2` deploying `${{ steps.task.outputs.task-definition }}` to service `api` in cluster `shop`, waiting for service stability.
---starter
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
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-deploy
          aws-region: eu-west-1
      - id: task
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: ecs/task-definition.json
          container-name: api
          image: 123456789012.dkr.ecr.eu-west-1.amazonaws.com/api:${{ github.sha }}
---rule
uses:\s*aws-actions/amazon-ecs-deploy-task-definition@v2
`amazon-ecs-deploy-task-definition@v2`
---rule
task-definition:\s*\$\{\{\s*steps\.task\.outputs\.task-definition\s*\}\}
Use the rendered task definition
---rule
service:\s*api\s*$
`service: api`
---rule
cluster:\s*shop\s*$
`cluster: shop`
---rule
wait-for-service-stability:\s*true
`wait-for-service-stability: true`
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
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-deploy
          aws-region: eu-west-1
      - id: task
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: ecs/task-definition.json
          container-name: api
          image: 123456789012.dkr.ecr.eu-west-1.amazonaws.com/api:${{ github.sha }}
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ${{ steps.task.outputs.task-definition }}
          service: api
          cluster: shop
          wait-for-service-stability: true
:::

:::exercise
id: gd-k8s
level: 2
title: Roll out on Kubernetes
mode: code
lang: bash
file: deploy.sh
---
Write the two `kubectl` commands that update the `api` container of `deployment/api` to `ghcr.io/acme/api:$TAG`, then wait for the rollout to finish with a **5 minute** timeout.
---starter
#!/bin/sh
set -e
---rule
kubectl\s+set\s+image\s+deployment/api\s+api=ghcr\.io/acme/api:\$\{?TAG\}?
`kubectl set image deployment/api api=ghcr.io/acme/api:$TAG`
---rule
kubectl\s+rollout\s+status\s+deployment/api\s+--timeout[ =]5m
`kubectl rollout status deployment/api --timeout=5m`
---rule
set\s+image[\s\S]*rollout\s+status
Update first, then wait
---solution
#!/bin/sh
set -e
kubectl set image deployment/api api=ghcr.io/acme/api:$TAG
kubectl rollout status deployment/api --timeout=5m
:::

:::exercise
id: gd-smoke
level: 2
title: A smoke test that fails the deploy
mode: code
lang: bash
file: smoke-test.sh
---
Write a smoke test that requests `$1/health` with `curl` using `--fail` (so HTTP errors give a non-zero exit), `--silent --show-error`, and retries **5** times with `--retry-connrefused`.
---starter
#!/bin/sh
set -e
---rule
curl\s+[^\n]*--fail
`--fail`
---rule
curl\s+[^\n]*--retry[ =]5
`--retry 5`
---rule
curl\s+[^\n]*--retry-connrefused
`--retry-connrefused`
---rule
curl\s+[^\n]*(--silent|-s\b)
`--silent`
---rule
curl\s+[^\n]*(--show-error|-S\b)
`--show-error`
---rule
curl\s+[^\n]*"?\$\{?1\}?/health"?
Request `$1/health`
---solution
#!/bin/sh
set -e
curl --fail --silent --show-error --retry 5 --retry-connrefused "$1/health"
:::

:::exercise
id: gd-rename-order
level: 3
title: Expand and contract
mode: answer
---
You need to rename the column `users.fullname` to `users.display_name` with zero downtime. Put these steps in order (answer with the letters, e.g. `DCBA`):

- **A**: drop `fullname`
- **B**: add nullable `display_name`
- **C**: deploy code that only reads and writes `display_name`
- **D**: deploy code that writes both columns, and backfill `display_name` from `fullname`
---answer
BDCA
---solution
BDCA
:::

:::exercise
id: gd-strategy
level: 2
title: Name the strategy
mode: answer
---
You route 5% of production traffic to the new version for 15 minutes, compare its error rate with the old version, and then increase the share step by step. What is this strategy called?
---answer
canary
---answer
canary deployment
---answer
canary release
---solution
canary
:::

:::exercise
id: proj-cd-06-promote
level: 4
title: "Project 6: staging → production"
mode: code
lang: yaml
file: .github/workflows/deploy.yml
---
Write two jobs. `staging` (needs `image`, environment `staging`) runs `./scripts/deploy.sh staging ghcr.io/acme/taskboard:${{ github.sha }}` then `./scripts/smoke-test.sh https://staging.taskboard.dev`. `production` (needs `staging`, environment `production` with url `https://taskboard.dev`) runs the same deploy script with `production` and smoke-tests `https://taskboard.dev`. Add a top-level concurrency group `deploy` that **doesn't** cancel in-progress runs.
---starter
name: Deploy
on:
  push:
    branches: [main]

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - run: echo "build and push ghcr.io/acme/taskboard:${{ github.sha }}"
---rule
^concurrency:\s*\n\s+group:\s*deploy\s*\n\s+cancel-in-progress:\s*false
Deployment concurrency without cancelling
---rule
staging:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*\[?\s*image\s*\]?
`staging` needs `image`
---rule
staging:\s*\n(\s{4}.*\n)*?\s{4}environment:\s*staging
`staging` environment
---rule
run:\s*\./scripts/deploy\.sh staging ghcr\.io/acme/taskboard:\$\{\{\s*github\.sha\s*\}\}
Deploy the SHA image to staging
---rule
run:\s*\./scripts/smoke-test\.sh https://staging\.taskboard\.dev
Smoke-test staging
---rule
production:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*\[?\s*staging\s*\]?
`production` needs `staging`
---rule
environment:\s*\n\s+name:\s*production\s*\n\s+url:\s*https://taskboard\.dev
Production environment with URL
---rule
run:\s*\./scripts/deploy\.sh production ghcr\.io/acme/taskboard:\$\{\{\s*github\.sha\s*\}\}
Deploy the same image to production
---rule
run:\s*\./scripts/smoke-test\.sh https://taskboard\.dev
Smoke-test production
---solution
name: Deploy
on:
  push:
    branches: [main]

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - run: echo "build and push ghcr.io/acme/taskboard:${{ github.sha }}"
  staging:
    needs: image
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/deploy.sh staging ghcr.io/acme/taskboard:${{ github.sha }}
      - run: ./scripts/smoke-test.sh https://staging.taskboard.dev
  production:
    needs: staging
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://taskboard.dev
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/deploy.sh production ghcr.io/acme/taskboard:${{ github.sha }}
      - run: ./scripts/smoke-test.sh https://taskboard.dev
:::

:::exercise
id: proj-cd-06-smoke
level: 3
title: "Project 6b: Taskboard's smoke test"
mode: code
lang: bash
file: scripts/smoke-test.sh
---
Write `scripts/smoke-test.sh`: `set -euo pipefail`; take the base URL as `$1` into a variable `BASE`; request `$BASE/health` with `curl --fail --silent --show-error --retry 5 --retry-connrefused`; then check `$BASE/tasks` returns HTTP **401** without credentials, by comparing `curl -s -o /dev/null -w '%{http_code}' "$BASE/tasks"` to `401` and exiting 1 if it differs.
---starter
#!/bin/bash
---rule
set\s+-euo\s+pipefail
Strict mode
---rule
BASE="?\$\{?1\}?"?
`BASE=$1`
---rule
curl\s+(?=[^\n]*--fail)(?=[^\n]*--retry[ =]5)(?=[^\n]*--retry-connrefused)[^\n]*"?\$\{?BASE\}?/health"?
Health check with retries
---rule
curl\s+-s\s+-o\s+/dev/null\s+-w\s+['"]%\{http_code\}['"]\s+"?\$\{?BASE\}?/tasks"?
Capture the status of `/tasks`
---rule
401
Compare with 401
---rule
exit\s+1
Fail when it differs
---solution
#!/bin/bash
set -euo pipefail
BASE="$1"
curl --fail --silent --show-error --retry 5 --retry-connrefused "$BASE/health"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/tasks")
if [ "$code" != "401" ]; then
  echo "expected 401 from /tasks without credentials, got $code" >&2
  exit 1
fi
:::
