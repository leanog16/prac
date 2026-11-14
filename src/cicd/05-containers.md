---
id: cicd-containers
title: Building & publishing images
summary: Building Docker images in CI with Buildx, logging in to GitHub Container Registry, Docker Hub and Amazon ECR, tagging strategies with docker/metadata-action, registry and GitHub Actions layer caches, multi-platform builds, scanning with Trivy before pushing, and SBOM/provenance attestations.
minutes: 35
---
> [!project] Taskboard, step 5: publishing the image
> Every merge to `main` now produces `ghcr.io/acme/taskboard:sha-<commit>`, built with a layer cache, scanned for vulnerabilities, and pushed only if the scan is clean.

## The standard image pipeline

```yaml title=.github/workflows/image.yml
name: Image

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        if: github.event_name != 'pull_request'
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

What each piece does:

- **`setup-buildx-action`** creates a BuildKit builder (needed for caching, multi-platform builds and attestations).
- **`login-action`** authenticates to the registry. For **GHCR** (`ghcr.io`), the built-in `GITHUB_TOKEN` works if the job has `packages: write`.
- **`metadata-action`** computes tags and OCI labels from the event: `sha-3f2c1ab` for every build, `main` for branch pushes, `1.4.2` and `1.4` for a `v1.4.2` tag.
- **`build-push-action`** builds and, on pushes to `main` or tags, pushes. Pull requests build (proving the Dockerfile works) but don't push.

## Tagging strategy

| Tag | Mutable? | Use |
|---|---|---|
| `sha-3f2c1ab` (commit) | no | what you **deploy**: traceable to exact source |
| `1.4.2` (semver) | no (by convention) | releases |
| `1.4`, `1` | yes, moves to the latest patch/minor | consumers who want updates |
| `main` / `latest` | yes | convenience, never for production deploys |

Deploy by immutable tag or by **digest** (`ghcr.io/acme/api@sha256:…`). If production runs `:latest`, you can't tell what's running or roll back reliably.

## Layer caching in CI

Every runner starts with an empty Docker cache, so without help every build reinstalls every dependency. Options:

- **`type=gha`**: stores BuildKit layers in the GitHub Actions cache. Simple; subject to the repository's cache size limit.
- **`type=registry,ref=ghcr.io/acme/api:buildcache`**: stores the cache as an image in your registry. Shared across branches and CI systems.
- `mode=max` caches layers of **all** stages (including the build stage of a multi-stage Dockerfile), not just the final image's.

A well-ordered Dockerfile (dependencies before source, from the Docker track) matters as much as the cache backend.

## Other registries

```yaml
# Docker Hub
- uses: docker/login-action@v3
  with:
    username: ${{ vars.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}       # an access token, not your password

# Amazon ECR (after configure-aws-credentials with OIDC)
- id: ecr
  uses: aws-actions/amazon-ecr-login@v2
- uses: docker/build-push-action@v6
  with:
    push: true
    tags: ${{ steps.ecr.outputs.registry }}/shop-api:${{ github.sha }}
```

## Multi-platform images

```yaml
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v6
  with:
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ${{ steps.meta.outputs.tags }}
```

QEMU emulation makes the non-native platform slow. For heavy builds, use native ARM runners (`ubuntu-24.04-arm`) and merge the per-platform images into one manifest, or cross-compile in the Dockerfile.

## Scan before you ship

Fail the pipeline when the image has serious known vulnerabilities, **before** it reaches the registry or production:

```yaml
- uses: docker/build-push-action@v6
  with:
    load: true                    # load into the local Docker engine, don't push yet
    tags: api:scan
- uses: aquasecurity/trivy-action@0.28.0
  with:
    image-ref: api:scan
    severity: CRITICAL,HIGH
    exit-code: "1"                # fail the job on findings
    ignore-unfixed: true
- uses: docker/build-push-action@v6
  with:
    push: true
    tags: ${{ steps.meta.outputs.tags }}
```

The second build may reuse cached layers, but rebuilding does not prove the published bytes match the scanned image. For a strict gate, scan and promote the same image digest. Also scan the source and dependencies (Dependabot, CodeQL, `pip-audit`, `npm audit`) and upload results as SARIF to GitHub's security tab.

## Attestations: SBOM and provenance

```yaml
- uses: docker/build-push-action@v6
  with:
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    sbom: true
    provenance: mode=max
```

The **SBOM** lists every package in the image. **Provenance** records how, where and from which commit the image was built (SLSA). Together they let consumers verify an image came from your pipeline, and let you answer "which images contain the vulnerable library?" in minutes.

## Worked example: what metadata-action produces for Taskboard

With `tags: type=sha` and `type=semver,pattern={{version}}`, the same workflow tags differently depending on the event:

| Event | Tags produced |
|---|---|
| push to `main`, commit `3f2c1ab` | `ghcr.io/acme/taskboard:sha-3f2c1ab` |
| push of git tag `v1.2.0` at that commit | `…:sha-3f2c1ab`, `…:1.2.0` |
| pull request #42 | (built, not pushed) |

Every image is traceable to a commit; releases additionally get a human-friendly version. And since tags are computed rather than typed, nobody can fat-finger `1.2.0` onto the wrong image.

## Worked example: scanning before pushing

```
build (load locally) ─► trivy scan ─► CRITICAL/HIGH found? ─► fail, nothing pushed
                                        │
                                        └─ clean ─► build again (cache hit, seconds) ─► push
```

The scan gate blocks publication when the scanner finds a vulnerability covered by its policy. Scans cannot detect every vulnerability, and a rebuild after scanning can produce different bytes; promote the scanned digest for a reliable gate. When it fails, the fix is usually bumping the base image (`python:3.12-slim` gets patched regularly) or a dependency.

> [!plain] In plain English
> CI builds the image the same way every time, labels it with the commit it came from, checks it for known security holes, and only then uploads it where servers can download it.

:::quiz
q: Which permission does the GITHUB_TOKEN need to push images to ghcr.io?
- contents: write
+ packages: write
- id-token: write
- actions: write
why: GHCR is part of GitHub Packages.
:::

:::quiz
q: Why tag images with the commit SHA?
+ it's immutable and traces the running image back to its exact source
- registries require it
- it makes images smaller
- it enables layer caching
why: SHA tags make deployments reproducible and rollbacks precise.
:::

:::quiz
q: What does `cache-to: type=gha,mode=max` store?
- the final image only
+ build cache layers for all stages, in the GitHub Actions cache
- the pushed image in the GitHub cache
- test results
why: mode=max caches intermediate stages too, which matters for multi-stage builds.
:::

:::quiz
q: Why do pull request builds usually not push?
+ PRs (especially from forks) shouldn't publish images, but building still proves the Dockerfile works
- pushing is impossible from PRs
- GHCR rejects PR images
- it saves disk space on the runner
why: Build on PRs, publish only from trusted refs.
:::

:::exercise
id: gc-ghcr-login
level: 2
title: Log in to GHCR
mode: code
lang: yaml
file: .github/workflows/image.yml
---
Add a `docker/login-action@v3` step that logs in to `ghcr.io` as `${{ github.actor }}` with the password `${{ secrets.GITHUB_TOKEN }}`, and give the workflow `packages: write` (plus `contents: read`).
---starter
name: Image
on:
  push:
    branches: [main]

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
---rule
^permissions:\s*\n(\s+.*\n)*?\s+packages:\s*write
`packages: write`
---rule
^permissions:\s*\n(\s+.*\n)*?\s+contents:\s*read
`contents: read`
---rule
uses:\s*docker/login-action@v3
`docker/login-action@v3`
---rule
registry:\s*ghcr\.io
`registry: ghcr.io`
---rule
username:\s*\$\{\{\s*github\.actor\s*\}\}
`username: ${{ github.actor }}`
---rule
password:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}
`password: ${{ secrets.GITHUB_TOKEN }}`
---solution
name: Image
on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
:::

:::exercise
id: gc-build-push
level: 2
title: Build and push with a SHA tag
mode: code
lang: yaml
file: .github/workflows/image.yml
---
After login, add `docker/build-push-action@v6` that builds context `.`, **pushes**, and tags the image `ghcr.io/acme/api:${{ github.sha }}`.
---starter
name: Image
on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
---rule
uses:\s*docker/build-push-action@v6
`docker/build-push-action@v6`
---rule
context:\s*\.\s*$
`context: .`
---rule
push:\s*true
`push: true`
---rule
tags:\s*ghcr\.io/acme/api:\$\{\{\s*github\.sha\s*\}\}
`tags: ghcr.io/acme/api:${{ github.sha }}`
---rule
login-action@v3[\s\S]*build-push-action@v6
After login
---solution
name: Image
on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  image:
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
:::

:::exercise
id: gc-cache
level: 2
title: Add a layer cache
mode: code
lang: yaml
file: .github/workflows/image.yml
---
Make the build use the **GitHub Actions cache** backend for BuildKit, reading from it and writing to it in **max** mode.
---starter
name: Image
on: [push]

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          tags: api:ci
---rule
cache-from:\s*type=gha\s*$
`cache-from: type=gha`
---rule
cache-to:\s*type=gha,\s*mode=max
`cache-to: type=gha,mode=max`
---solution
name: Image
on: [push]

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          tags: api:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
:::

:::exercise
id: gc-pr-no-push
level: 3
title: Build on PRs, push on main
mode: code
lang: yaml
file: .github/workflows/image.yml
---
The workflow runs on pushes and pull requests. Skip the login step for pull requests (`if: github.event_name != 'pull_request'`) and set `push:` to the expression `${{ github.event_name != 'pull_request' }}`.
---starter
name: Image
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  packages: write

jobs:
  image:
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
---rule
uses:\s*docker/login-action@v3\s*\n\s+if:\s*(\$\{\{\s*)?github\.event_name\s*!=\s*'pull_request'|if:\s*(\$\{\{\s*)?github\.event_name\s*!=\s*'pull_request'[^\n]*\n\s+uses:\s*docker/login-action@v3
Login skipped on PRs
---rule
push:\s*\$\{\{\s*github\.event_name\s*!=\s*'pull_request'\s*\}\}
`push: ${{ github.event_name != 'pull_request' }}`
---solution
name: Image
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        if: github.event_name != 'pull_request'
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ghcr.io/acme/api:${{ github.sha }}
:::

:::exercise
id: gc-metadata
level: 3
title: Tags from metadata-action
mode: code
lang: yaml
file: .github/workflows/image.yml
---
Add a `docker/metadata-action@v5` step with `id: meta` for the image `ghcr.io/acme/api`, producing tags `type=sha` and `type=semver,pattern={{version}}`. Then use `${{ steps.meta.outputs.tags }}` and `${{ steps.meta.outputs.labels }}` in the build step.
---starter
name: Image
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/acme/api:latest
---rule
-\s*id:\s*meta\s*\n\s+uses:\s*docker/metadata-action@v5|uses:\s*docker/metadata-action@v5\s*\n\s+id:\s*meta
`id: meta` with `docker/metadata-action@v5`
---rule
images:\s*ghcr\.io/acme/api
`images: ghcr.io/acme/api`
---rule
type=sha
`type=sha`
---rule
type=semver,pattern=\{\{version\}\}
`type=semver,pattern={{version}}`
---rule
tags:\s*\$\{\{\s*steps\.meta\.outputs\.tags\s*\}\}
Build uses the computed tags
---rule
labels:\s*\$\{\{\s*steps\.meta\.outputs\.labels\s*\}\}
Build uses the computed labels
---rule
!api:latest
No hard-coded `latest`
---solution
name: Image
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/acme/api
          tags: |
            type=sha
            type=semver,pattern={{version}}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
:::

:::exercise
id: gc-trivy
level: 3
title: Gate on a scan
mode: code
lang: yaml
file: .github/workflows/image.yml
---
Between the local build (`load: true`, tag `api:scan`) and the push, add `aquasecurity/trivy-action@0.28.0` scanning `image-ref: api:scan` for `CRITICAL,HIGH` severities, failing the job (`exit-code: "1"`) on findings.
---starter
name: Image
on:
  push:
    branches: [main]

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          load: true
          tags: api:scan
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/acme/api:${{ github.sha }}
---rule
uses:\s*aquasecurity/trivy-action@0\.28\.0
`aquasecurity/trivy-action@0.28.0`
---rule
image-ref:\s*["']?api:scan["']?
`image-ref: api:scan`
---rule
severity:\s*["']?CRITICAL,HIGH["']?
`severity: CRITICAL,HIGH`
---rule
exit-code:\s*["']1["']
`exit-code: "1"`
---rule
load:\s*true[\s\S]*trivy-action[\s\S]*push:\s*true
Scan between the local build and the push
---solution
name: Image
on:
  push:
    branches: [main]

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          load: true
          tags: api:scan
      - uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: api:scan
          severity: CRITICAL,HIGH
          exit-code: "1"
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/acme/api:${{ github.sha }}
:::

:::exercise
id: gc-semver-tags
level: 2
title: Predict: semver tags
mode: answer
---
`docker/metadata-action` has `tags: type=semver,pattern={{major}}.{{minor}}`. The workflow runs for the git tag `v2.5.9`. Which image tag does it produce?
---answer
2.5
---solution
2.5
:::

:::exercise
id: proj-cd-05-image
level: 4
title: "Project 5: the image job"
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Write the `image` job (needs `test`, only on pushes: `if: github.event_name == 'push'`, permissions `contents: read` + `packages: write`): checkout; `docker/setup-buildx-action@v3`; `docker/login-action@v3` to `ghcr.io` with `${{ github.actor }}` / `${{ secrets.GITHUB_TOKEN }}`; `docker/metadata-action@v5` (id `meta`, images `ghcr.io/acme/taskboard`, tags `type=sha`); `docker/build-push-action@v6` with `push: true`, the meta tags and labels, and the `gha` cache (`mode=max`).
---starter
name: CI
on: [push, pull_request]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest -q
---rule
image:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*\[?\s*test\s*\]?
`image` needs `test`
---rule
image:\s*\n(\s{4}.*\n)*?\s{4}if:\s*(\$\{\{\s*)?github\.event_name\s*==\s*'push'
Only on pushes
---rule
image:\s*\n(\s{4}.*\n)*?\s{4}permissions:\s*\n(\s{6}.*\n)*?\s{6}packages:\s*write
`packages: write`
---rule
docker/setup-buildx-action@v3[\s\S]*docker/login-action@v3[\s\S]*registry:\s*ghcr\.io
Buildx and GHCR login
---rule
password:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}
Login with `GITHUB_TOKEN`
---rule
id:\s*meta\s*\n\s+uses:\s*docker/metadata-action@v5|uses:\s*docker/metadata-action@v5\s*\n\s+id:\s*meta
`metadata-action` with id `meta`
---rule
images:\s*ghcr\.io/acme/taskboard
Image name
---rule
type=sha
`type=sha` tags
---rule
uses:\s*docker/build-push-action@v6[\s\S]*push:\s*true[\s\S]*tags:\s*\$\{\{\s*steps\.meta\.outputs\.tags\s*\}\}
Build and push with the meta tags
---rule
labels:\s*\$\{\{\s*steps\.meta\.outputs\.labels\s*\}\}
Meta labels
---rule
cache-from:\s*type=gha[\s\S]*cache-to:\s*type=gha,\s*mode=max
GHA cache
---solution
name: CI
on: [push, pull_request]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest -q
  image:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/acme/taskboard
          tags: type=sha
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
:::

:::exercise
id: proj-cd-05-tag-predict
level: 2
title: "Project 5b: predict the tag"
mode: answer
---
With `docker/metadata-action` and `tags: type=sha` (default short SHA, prefix `sha-`), a push lands commit `9c1e2f0d4b…` on `main`. Which tag is produced (just the tag part after the colon)?
---answer
sha-9c1e2f0
---solution
sha-9c1e2f0
:::
