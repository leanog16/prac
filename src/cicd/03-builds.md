---
id: cicd-builds
title: Building & testing in CI
summary: Setting up language toolchains, dependency caching (built-in and actions/cache with hashFiles keys), matrix builds with include/exclude and fail-fast, service containers for databases, uploading and downloading artifacts, job outputs, test reports and timeouts.
minutes: 40
---
## Toolchains

Setup actions install a language version and put it on the `PATH`:

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: "3.12"
    cache: pip                 # cache ~/.cache/pip keyed on requirements files

- uses: actions/setup-java@v4
  with:
    distribution: temurin
    java-version: "21"
    cache: maven               # cache ~/.m2/repository keyed on pom.xml

- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: npm                 # keyed on package-lock.json
```

Quote versions like `"3.10"`: unquoted, YAML reads `3.10` as the number `3.1`.

## Caching dependencies

Downloading dependencies on every run is slow and hammers package registries. The `cache:` option above covers common cases. For anything else, use `actions/cache` directly:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: pip-${{ runner.os }}-${{ hashFiles('**/requirements*.txt') }}
    restore-keys: |
      pip-${{ runner.os }}-
```

- **`key`**: exact match restores the cache and skips saving at the end. Include `hashFiles(...)` of your lock files, so the key changes exactly when dependencies change.
- **`restore-keys`**: prefixes to fall back on when there's no exact match (an older, mostly-right cache is better than none). A new cache is saved under `key` after the job.
- Cache **dependency downloads**, not build outputs you then ship: artifacts must come from a clean build.

## Matrix builds

Test against several versions or platforms in parallel with one job definition:

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        python: ["3.11", "3.12", "3.13"]
        exclude:
          - os: windows-latest
            python: "3.11"
        include:
          - os: ubuntu-latest
            python: "3.13"
            coverage: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
      - run: pytest
      - if: matrix.coverage
        run: pytest --cov --cov-report=xml
```

- The matrix expands to every combination: 2 × 3 = 6 jobs, minus the exclusion = 5.
- `include` adds extra variables to matching combinations (or adds new combinations).
- **`fail-fast: true`** (the default) cancels the other matrix jobs when one fails. Set `false` to see every failure.
- `max-parallel` limits how many run at once.

## Service containers

Integration tests often need a real database. `services` starts containers next to the job:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: app
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:test@localhost:5432/app
    steps:
      - uses: actions/checkout@v4
      - run: pytest tests/integration
```

The health options make the job wait until PostgreSQL accepts connections. When the job runs directly on the runner, reach the service on `localhost` via the mapped port. When the job itself runs in a container (`container:`), use the service name (`postgres`) as the hostname instead. (Testcontainers also works on GitHub-hosted Linux runners, since Docker is preinstalled.)

## Artifacts: passing files between jobs

Jobs don't share a filesystem. Upload files from one job and download them in another (or from the run's page in the UI):

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./mvnw -q package -DskipTests
      - uses: actions/upload-artifact@v4
        with:
          name: app-jar
          path: target/*.jar
          retention-days: 7

  smoke-test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: app-jar
      - run: java -jar *.jar --smoke-test
```

Artifacts are for CI handoffs and reports. Release outputs (images, packages) belong in a **registry**.

## Job outputs: passing values between jobs

For small values (a version string, a flag), use outputs instead of artifacts:

```yaml
jobs:
  version:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.v.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - id: v
        run: echo "tag=$(git describe --tags --always)" >> "$GITHUB_OUTPUT"

  build:
    needs: version
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building ${{ needs.version.outputs.tag }}"
```

A step writes `name=value` to `$GITHUB_OUTPUT`; the step needs an `id`; the job maps it under `outputs:`; dependent jobs read `needs.<job>.outputs.<name>`.

## Test reports and timeouts

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15            # the default is 360: a hung test would burn 6 hours
    steps:
      - uses: actions/checkout@v4
      - run: pytest --junitxml=reports/junit.xml
      - uses: actions/upload-artifact@v4
        if: always()               # upload the report even when tests fail
        with:
          name: test-report
          path: reports/
```

Always set `timeout-minutes`. Writing a summary to `$GITHUB_STEP_SUMMARY` (Markdown) shows it on the run's page.

:::quiz
q: A cache `key` includes `hashFiles('**/package-lock.json')`. When does the key change?
+ whenever package-lock.json changes, i.e. when dependencies change
- on every commit
- every day
- never
why: Hashing the lock file ties the cache to the exact dependency set.
:::

:::quiz
q: A matrix has `os: [ubuntu-latest, macos-latest]` and `node: [18, 20, 22]`. How many jobs run?
- 2
- 3
- 5
+ 6
why: Every combination: 2 × 3.
:::

:::quiz
q: Job B needs a jar built by job A. How does it get it?
- it's already on the runner's disk
+ A uploads it with upload-artifact, B downloads it with download-artifact
- B reads it from `needs.A.outputs`
- via `$GITHUB_ENV`
why: Each job runs on a fresh runner; artifacts carry files across jobs.
:::

:::quiz
q: With the default `fail-fast` setting, one matrix job fails. What happens to the others?
- they continue
+ in-progress and queued matrix jobs are cancelled
- they're retried
- the workflow is re-run
why: fail-fast defaults to true. Set it to false to see all failures.
:::

:::exercise
id: gb-setup-cache
level: 1
title: Python with pip caching
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
After checkout, set up Python **3.12** with the setup action's built-in **pip** cache, then install `requirements.txt` and run `pytest`.
---starter
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
---rule
uses:\s*actions/setup-python@v5
`actions/setup-python@v5`
---rule
python-version:\s*["']3\.12["']
`python-version: "3.12"` (quoted)
---rule
cache:\s*["']?pip["']?
`cache: pip`
---rule
run:\s*pip install -r requirements\.txt
Install the requirements
---rule
run:\s*pytest
Run `pytest`
---rule
setup-python[\s\S]*pip install[\s\S]*pytest
In that order
---solution
name: CI
on: [push]

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
:::

:::exercise
id: gb-cache
level: 3
title: A hand-rolled cache
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Add an `actions/cache@v4` step (before the build) that caches `~/.gradle/caches` with the key `gradle-${{ runner.os }}-${{ hashFiles('**/*.gradle*') }}` and falls back to any key starting with `gradle-${{ runner.os }}-`.
---starter
name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./gradlew build
---rule
uses:\s*actions/cache@v4
`actions/cache@v4`
---rule
path:\s*~/\.gradle/caches
`path: ~/.gradle/caches`
---rule
key:\s*gradle-\$\{\{\s*runner\.os\s*\}\}-\$\{\{\s*hashFiles\(\s*'\*\*/\*\.gradle\*'\s*\)\s*\}\}
The key with `hashFiles('**/*.gradle*')`
---rule
restore-keys:\s*\|?\s*\n\s+gradle-\$\{\{\s*runner\.os\s*\}\}-\s*$|restore-keys:\s*gradle-\$\{\{\s*runner\.os\s*\}\}-\s*$
`restore-keys` prefix
---rule
actions/cache@v4[\s\S]*gradlew build
Cache before the build
---solution
name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
        with:
          path: ~/.gradle/caches
          key: gradle-${{ runner.os }}-${{ hashFiles('**/*.gradle*') }}
          restore-keys: |
            gradle-${{ runner.os }}-
      - run: ./gradlew build
:::

:::exercise
id: gb-matrix
level: 2
title: Test three Java versions
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Turn `test` into a matrix over `java: ["17", "21", "23"]` with `fail-fast: false`, and use the matrix value as `java-version`.
---starter
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"
      - run: ./mvnw -q verify
---rule
strategy:\s*\n(\s+.*\n)*?\s+fail-fast:\s*false
`strategy.fail-fast: false`
---rule
matrix:\s*\n\s+java:\s*\[\s*["']17["']\s*,\s*["']21["']\s*,\s*["']23["']\s*\]
`matrix.java: ["17", "21", "23"]`
---rule
java-version:\s*\$\{\{\s*matrix\.java\s*\}\}
`java-version: ${{ matrix.java }}`
---solution
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        java: ["17", "21", "23"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: ${{ matrix.java }}
      - run: ./mvnw -q verify
:::

:::exercise
id: gb-services
level: 3
title: A Postgres service
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Add a service container `postgres` using `postgres:16` with env `POSTGRES_PASSWORD: test`, port `5432:5432`, and a health check `--health-cmd "pg_isready -U postgres"`. Set job-level env `DATABASE_URL: postgresql://postgres:test@localhost:5432/postgres`.
---starter
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest tests/integration
---rule
services:\s*\n\s+postgres:\s*\n\s+image:\s*["']?postgres:16["']?
`services.postgres.image: postgres:16`
---rule
POSTGRES_PASSWORD:\s*["']?test["']?
`POSTGRES_PASSWORD: test`
---rule
ports:\s*\n\s+-\s*["']?5432:5432["']?
Port `5432:5432`
---rule
--health-cmd\s+["']pg_isready -U postgres["']
The `pg_isready` health check
---rule
DATABASE_URL:\s*["']?postgresql://postgres:test@localhost:5432/postgres["']?
`DATABASE_URL` pointing at localhost
---solution
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:test@localhost:5432/postgres
    steps:
      - uses: actions/checkout@v4
      - run: pytest tests/integration
:::

:::exercise
id: gb-artifacts
level: 3
title: Build once, test the jar
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
In `build`, upload `target/*.jar` as an artifact named `app-jar`. Add a job `smoke` that needs `build`, downloads the `app-jar` artifact and runs `java -jar *.jar --smoke-test`.
---starter
name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./mvnw -q package -DskipTests
---rule
uses:\s*actions/upload-artifact@v4\s*\n\s+with:\s*\n(\s+.*\n)*?\s+name:\s*app-jar
Upload with `name: app-jar`
---rule
upload-artifact@v4[\s\S]*?path:\s*target/\*\.jar
`path: target/*.jar`
---rule
smoke:\s*\n(\s{4}.*\n)*?\s{4}needs:\s*\[?\s*build\s*\]?
`smoke` needs `build`
---rule
uses:\s*actions/download-artifact@v4\s*\n\s+with:\s*\n\s+name:\s*app-jar
Download `app-jar`
---rule
run:\s*java -jar \*\.jar --smoke-test
Run the smoke test
---solution
name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./mvnw -q package -DskipTests
      - uses: actions/upload-artifact@v4
        with:
          name: app-jar
          path: target/*.jar
  smoke:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: app-jar
      - run: java -jar *.jar --smoke-test
:::

:::exercise
id: gb-outputs
level: 4
title: Hand a version to the next job
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
In `version`, give the step the id `v` and make it write `tag=$(git describe --tags --always)` to `$GITHUB_OUTPUT`. Expose it as the job output `tag`. In `build`, use it as `docker build -t app:${{ needs.version.outputs.tag }} .`
---starter
name: CI
on: [push]

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: git describe --tags --always
  build:
    needs: version
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t app:latest .
---rule
version:\s*\n(\s{4}.*\n)*?\s{4}outputs:\s*\n\s+tag:\s*\$\{\{\s*steps\.v\.outputs\.tag\s*\}\}
Job output `tag: ${{ steps.v.outputs.tag }}`
---rule
-\s*id:\s*v\s*\n\s+run:\s*echo\s+"tag=\$\(git describe --tags --always\)"\s*>>\s*"?\$GITHUB_OUTPUT"?
Step `id: v` writes to `$GITHUB_OUTPUT`
---rule
docker build -t app:\$\{\{\s*needs\.version\.outputs\.tag\s*\}\}\s+\.
Use `needs.version.outputs.tag`
---solution
name: CI
on: [push]

jobs:
  version:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.v.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: v
        run: echo "tag=$(git describe --tags --always)" >> "$GITHUB_OUTPUT"
  build:
    needs: version
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t app:${{ needs.version.outputs.tag }} .
:::

:::exercise
id: gb-timeout
level: 1
title: Don't burn six hours
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Limit the `test` job to **20 minutes**.
---starter
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
---rule
test:\s*\n(\s{4}.*\n)*?\s{4}timeout-minutes:\s*20\s*$
`timeout-minutes: 20` on the job
---solution
name: CI
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - run: make test
:::

:::exercise
id: gb-matrix-count
level: 2
title: Count the jobs
mode: answer
---
```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
    node: [18, 20]
    exclude:
      - os: macos-latest
        node: 18
```

How many jobs does this matrix produce?
---answer
5
---solution
5
:::
