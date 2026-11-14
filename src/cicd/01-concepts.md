---
id: cicd-concepts
title: CI/CD fundamentals
summary: Continuous integration, continuous delivery and continuous deployment, what a pipeline is made of, build-once-promote artifacts, trunk-based development and branch protection, fast feedback and the test pyramid, versioning, and the DORA metrics.
minutes: 25
---
> [!project] Track project: Taskboard's delivery pipeline
> You built Taskboard in the FastAPI track and containerized it in the Docker track. In this track you'll give it a real **pipeline** in `.github/workflows/`: lint and test on every pull request, build and publish the image, deploy to staging automatically and to production with an approval. Each lesson's **Project** exercises add the next part.

## The problem CI/CD solves

Without automation, releasing software looks like this: developers work on long-lived branches for weeks, someone merges everything at the end ("merge hell"), a person builds the release on their laptop, follows a wiki page to deploy it, and everyone hopes. Bugs are found late, releases are rare and scary, and nobody can say exactly what's running in production.

**CI/CD** replaces that with small changes that are automatically built, tested and shipped through the same pipeline every time.

## Three related practices

| Practice | Means | Ends with |
|---|---|---|
| **Continuous integration (CI)** | every change is merged to the main branch often (at least daily) and automatically built and tested | a verified build of `main` |
| **Continuous delivery** | every change that passes CI is automatically packaged and deployable; releasing to production is a **button press** | a release candidate that *could* go live |
| **Continuous deployment** | every change that passes the pipeline goes to production **automatically**, no human step | the change is live |

Delivery vs deployment is the whole difference: is there a manual approval before production? Many teams do continuous deployment to staging and continuous delivery to production.

## Anatomy of a pipeline

A pipeline is a sequence of **stages**, each a gate that must pass before the next runs:

```
commit → lint & unit tests → build artifact → integration tests → security scans
       → deploy to staging → smoke tests → (approval) → deploy to production → verify
```

- **Fail fast**: put the cheapest, most likely-to-fail checks first (formatting, lint, unit tests). A developer should know within minutes.
- **Same steps every time**: the pipeline is code, versioned with the app, reviewed like the app.
- **Run in a clean environment**: a fresh runner or container, so "works on my machine" can't leak in.

## Build once, promote the artifact

The output of the build stage is an **artifact**: a Docker image, a jar, a wheel, a zip for Lambda. Build it **once**, give it an immutable identity (a version or the commit SHA), store it in a registry, and **promote that exact artifact** through staging and production.

Never rebuild for each environment. A rebuild can pick up a different dependency version or base image, so what you tested isn't what you ship. Environment differences belong in **configuration** (environment variables, secrets), not in different builds.

## Branching: trunk-based development

CI works best when branches are short-lived:

- **Trunk-based development**: everyone integrates into `main` at least daily; feature branches live hours or a day or two, merged through small pull requests.
- **Feature flags** hide unfinished work that's already merged, so merging and releasing are separate decisions.
- **GitFlow** (long-lived `develop` and `release` branches) suits software with versioned releases (libraries, mobile apps, on-prem products), but slows down web services.

**Branch protection** on `main` enforces the rules: pull requests required, CI checks must pass, at least one review, no force pushes. Those checks improve confidence that `main` is deployable, although tests and reviews cannot guarantee it.

## The test pyramid in a pipeline

| Layer | Count | Speed | Runs |
|---|---|---|---|
| unit tests | many | ms each | every push |
| integration tests (DB, HTTP, containers) | some | seconds | every push / PR |
| end-to-end tests (browser, full system) | few | minutes | before production, or nightly |

**Flaky tests** (pass and fail without code changes) destroy trust in CI: people start re-running until green and ignoring real failures. Quarantine and fix them quickly.

## Versioning

- **Semantic versioning** `MAJOR.MINOR.PATCH`: bump MAJOR for breaking changes, MINOR for backward-compatible features, PATCH for fixes. Essential for libraries and public APIs.
- **Commit SHA** tags (`api:3f2c1ab`) for services deployed continuously: every artifact is traceable to exact source code.
- **Git tags** (`v1.4.0`) as release triggers; tools like semantic-release or release-please generate versions and changelogs from conventional commit messages (`feat:`, `fix:`, `feat!:`).

## Measuring delivery: the DORA metrics

Research by the DORA team identified four metrics that distinguish high-performing teams:

| Metric | Measures | Elite teams |
|---|---|---|
| **Deployment frequency** | how often you deploy to production | on demand, many times a day |
| **Lead time for changes** | commit to running in production | under a day |
| **Change failure rate** | share of deployments causing a failure | low (0–15%) |
| **Time to restore service** | how fast you recover from a failure | under an hour |

The first two measure speed, the last two stability. The key finding: they **improve together**. Small, frequent, automated changes are both faster and safer than big, rare, manual ones.

## Worked example: Taskboard's pipeline on one page

Before writing YAML, sketch the stages and what each one guards against:

```
pull request ─► lint (ruff) ─► unit tests (pytest) ─► build image (no push)
                  2 min          3 min                     2 min
                         └── fast feedback before review ──┘

merge to main ─► same checks ─► build + push ghcr.io/acme/taskboard:<sha>
              ─► deploy to staging ─► smoke test ─► (approval) ─► deploy to production ─► smoke test
```

| Stage | Catches |
|---|---|
| lint | style problems, unused imports, obvious bugs |
| unit tests | broken business rules (status transitions, validation) |
| image build | missing dependencies, Dockerfile mistakes |
| staging deploy + smoke test | configuration, migrations, networking problems |
| approval | a human sanity check before customers see it |

The image built from `main` is tagged with the **commit SHA**, and **that exact image** goes to staging and then production. Nothing is rebuilt between environments.

> [!plain] In plain English
> A pipeline is an assembly line for code changes. Every change goes through the same checks in the same order, automatically, and stops at the first one that fails.

## How long should it take?

Aim for **under 10 minutes** from push to a green or red pull request. Past that, developers start batching changes and stop waiting for results, which defeats the purpose. Lessons 3 and 7 are about keeping it fast.

## Common mistakes

> [!mistake] Pipelines that only run on main
> If checks run only after merging, broken code is already on `main`. Run them on pull requests and make them **required** before merging.

:::quiz
q: What is the difference between continuous delivery and continuous deployment?
+ delivery keeps every passing change ready to release with a manual go-live step; deployment releases every passing change automatically
- delivery is for libraries, deployment is for services
- deployment skips testing
- there is no difference
why: The only difference is whether a human approves the production release.
:::

:::quiz
q: Why build the artifact once and promote it, rather than rebuilding per environment?
- rebuilding is slower
+ so the artifact that reaches production is exactly the one that was tested
- registries can't store multiple builds
- because environments can't have different configuration
why: Rebuilds can differ (new dependency versions, base images). Promotion guarantees what you tested is what you ship.
:::

:::quiz
q: Which checks should run first in a pipeline?
+ fast, cheap checks like lint and unit tests
- end-to-end browser tests
- the production deployment
- load tests
why: Fail fast: give developers feedback in minutes.
:::

:::quiz
q: Which pair of DORA metrics measures stability?
- deployment frequency and lead time
+ change failure rate and time to restore service
- test coverage and build time
- lead time and change failure rate
why: Frequency and lead time measure throughput; failure rate and restore time measure stability.
:::

:::exercise
id: cc-semver-patch
level: 1
title: Bump for a fix
mode: answer
---
Your library is at `2.7.3`. You fix a bug without changing the public API. What's the new version?
---answer
2.7.4
---solution
2.7.4
:::

:::exercise
id: cc-semver-major
level: 2
title: Bump for a breaking change
mode: answer
---
Your library is at `2.7.3`. You rename a public function that callers depend on. What's the new version?
---answer
3.0.0
---solution
3.0.0
---explain
Breaking changes bump MAJOR and reset MINOR and PATCH.
:::

:::exercise
id: cc-semver-minor
level: 1
title: Bump for a feature
mode: answer
---
Your library is at `2.7.3`. You add a new optional parameter; existing callers keep working. What's the new version?
---answer
2.8.0
---solution
2.8.0
:::

:::exercise
id: cc-delivery-or-deployment
level: 2
title: Delivery or deployment?
mode: answer
---
Every merge to `main` is built, tested, deployed to staging, and then waits for a product manager to click **Approve** before going to production. Is this continuous **delivery** or continuous **deployment**?
---answer
delivery
---answer
continuous delivery
---solution
continuous delivery
:::

:::exercise
id: cc-commit-type
level: 2
title: Conventional commits
mode: answer
---
With conventional commits and semantic-release, which commit type prefix produces a **minor** version bump?
---answer
feat
---answer
feat:
---solution
feat
---explain
`fix:` → patch, `feat:` → minor, `feat!:` or a `BREAKING CHANGE:` footer → major.
:::

:::exercise
id: cc-dora-lead
level: 2
title: Name the metric
mode: answer
---
Which DORA metric measures the time from a commit being made to that commit running in production?
---answer
lead time for changes
---answer
lead time
---answer
change lead time
---solution
lead time for changes
:::

:::exercise
id: proj-cd-01-order
level: 2
title: "Project 1: order the stages"
mode: answer
---
Put Taskboard's main-branch stages in order (answer with the letters, e.g. `ABCDE`): **A** deploy to production, **B** run unit tests, **C** build and push the image, **D** deploy to staging, **E** smoke-test staging.
---answer
BCDEA
---solution
BCDEA
:::

:::exercise
id: proj-cd-01-tag
level: 2
title: "Project 1b: which tag ships?"
mode: answer
---
Commit `3f2c1ab` on `main` passes CI and its image is tested in staging. Which tag of `ghcr.io/acme/taskboard` should production run: `latest`, `main`, or `sha-3f2c1ab`?
---answer
sha-3f2c1ab
---solution
sha-3f2c1ab
---explain
Only the SHA tag is immutable and identical to what staging tested; `latest` and `main` move with every merge.
:::
