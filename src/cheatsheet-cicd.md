## Workflow skeleton

```yaml
name: CI
on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        python: ["3.12", "3.13"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
          cache: pip
      - run: pip install -r requirements.txt
      - run: pytest
```

## Triggers

| Event | Notes |
|---|---|
| `push: branches/tags/paths` | `paths-ignore` to skip docs-only changes |
| `pull_request: branches` | filters the **target** branch; forks get no secrets |
| `schedule: - cron: "0 6 * * 1-5"` | UTC |
| `workflow_dispatch: inputs` | manual run, `${{ inputs.x }}` |
| `workflow_call` | makes it a reusable workflow |
| `merge_group` | needed for merge queues |

## Jobs and data

| Need | Use |
|---|---|
| order jobs | `needs: [lint, test]` |
| conditional | `if: github.ref == 'refs/heads/main'`, `if: failure()`, `if: always()` |
| value to later **steps** | `echo "K=v" >> "$GITHUB_ENV"` |
| value to later **jobs** | step `id`, `echo "k=v" >> "$GITHUB_OUTPUT"`, job `outputs:`, `needs.job.outputs.k` |
| files between jobs | `actions/upload-artifact@v4` / `download-artifact@v4` |
| cache deps | `cache:` in setup actions, or `actions/cache@v4` with `hashFiles(...)` key |
| a database | `services: postgres: image, env, ports, options: --health-cmd …` |

## Contexts

`github.ref` (`refs/heads/main`) · `github.ref_name` (`main`) · `github.sha` · `github.event_name` · `github.actor` · `github.repository` · `secrets.X` · `vars.X` · `matrix.x` · `needs.job.outputs.x` · `steps.id.outputs.x` · `runner.os` · `inputs.x`.

## Security

- `permissions:` least privilege (`contents: read` default; `packages: write` for GHCR; `id-token: write` for OIDC).
- Secrets via `env:`, never `${{ }}` inside `run:` with untrusted input (script injection).
- OIDC to clouds: `aws-actions/configure-aws-credentials@v4` with `role-to-assume`; trust policy on `sub` (`repo:org/repo:environment:production`).
- Pin third-party actions to a full commit SHA.
- `environment: production` for required reviewers and environment secrets.
- Never use `pull_request_target` with a checkout of the PR's code.

## Images

```yaml
- uses: docker/setup-buildx-action@v3
- uses: docker/login-action@v3
  with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
- id: meta
  uses: docker/metadata-action@v5
  with:
    images: ghcr.io/${{ github.repository }}
    tags: |
      type=sha
      type=semver,pattern={{version}}
- uses: docker/build-push-action@v6
  with:
    push: ${{ github.event_name != 'pull_request' }}
    tags: ${{ steps.meta.outputs.tags }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

## Deployment

| Strategy | Trade-off |
|---|---|
| recreate | simple, downtime |
| rolling | no downtime; old + new run together |
| blue/green | instant rollback; double capacity |
| canary | small blast radius; needs metrics |

Build once, promote the same artifact · expand → migrate → switch → contract for schema changes · smoke tests after deploy · `concurrency` with `cancel-in-progress: false` for deploys · rollback in one step (`kubectl rollout undo`, previous tag, circuit breaker).

## Reuse

```yaml
jobs:
  ci:
    uses: org/templates/.github/workflows/python-ci.yml@v1
    with: { python-version: "3.13" }
    secrets: inherit
```

Composite action: `runs: using: composite`, every `run` step needs `shell: bash`.

## Speed

cache deps and layers · parallel jobs · matrix sharding · path filters · cancel superseded runs · fail fast · timeouts · bigger runners for CPU-bound builds.

## Versions and metrics

SemVer: breaking → MAJOR, feature → MINOR, fix → PATCH · conventional commits `feat:` `fix:` `feat!:` · DORA: deployment frequency, lead time, change failure rate, time to restore.
