---
id: aws-fundamentals
title: AWS fundamentals
summary: Regions, Availability Zones and edge locations, the shared responsibility model, accounts and AWS Organizations, the root user, the CLI with profiles and SSO, credential resolution order, ARNs, tags, and the Well-Architected pillars.
minutes: 30
---
## Global infrastructure

| Concept | Is | Why it matters |
|---|---|---|
| **Region** | a geographic area (`us-east-1` N. Virginia, `eu-west-1` Ireland, `ap-southeast-2` Sydney) with its own independent set of services | data residency, latency to users, service availability and price differ per region |
| **Availability Zone (AZ)** | one or more data centers in a region with independent power and networking (`eu-west-1a`, `-1b`, `-1c`) | spreading across 2–3 AZs survives a data-center failure |
| **Edge location** | a point of presence for CloudFront (CDN) and Route 53 (DNS) | low latency for cached content worldwide |

Most resources are **regional** (EC2 instances, RDS databases, Lambda functions), a few are **global** (IAM, Route 53, CloudFront), and some live in a single **AZ** (an EC2 instance, an EBS volume, a subnet). "Highly available" on AWS almost always means "deployed across multiple AZs".

> [!warn] us-east-1 is special
> Some global services keep their control plane in `us-east-1`, and certificates for CloudFront must be created there. It's also the region with the most new features and the most famous outages. Pick the region closest to your users unless you have a reason not to.

## Shared responsibility

AWS secures the **cloud**; you secure what you put **in** it.

| AWS is responsible for | You are responsible for |
|---|---|
| physical data centers, hardware, network | your data and who can access it (IAM) |
| the hypervisor and managed-service infrastructure | OS patches on your EC2 instances |
| patching managed services (RDS engine, Lambda runtime) | security groups, network ACLs, encryption settings |
| | application code, secrets, backups you configure |

The more managed the service, the more AWS handles: with EC2 you patch the OS; with RDS AWS patches the database engine; with Lambda and S3 you mostly own only your code, data and permissions.

## Accounts and the root user

An **AWS account** is a hard boundary for resources, permissions and billing. Real organizations use **many** accounts (prod, staging, dev, security, logging) managed with **AWS Organizations**, often set up by **Control Tower**. **Service Control Policies (SCPs)** set guardrails that even account administrators can't bypass, e.g. "nobody may use regions outside the EU".

The **root user** (the account's email login) can do everything, including closing the account. Protect it with **MFA**, never create access keys for it, and don't use it day to day. Use IAM Identity Center users or roles instead.

## The AWS CLI

```bash
aws --version
aws configure sso                       # sign in through IAM Identity Center (recommended)
aws sso login --profile dev
aws sts get-caller-identity --profile dev     # "who am I?": account, user/role ARN
aws s3 ls --profile dev --region eu-west-1
aws ec2 describe-instances --output table
```

Configuration lives in `~/.aws/config` (profiles, regions, SSO settings) and `~/.aws/credentials` (static keys, if you must use them).

```ini title=~/.aws/config
[profile dev]
sso_session = acme
sso_account_id = 111111111111
sso_role_name = Developer
region = eu-west-1
output = json

[sso-session acme]
sso_start_url = https://acme.awsapps.com/start
sso_region = eu-west-1
```

### Where credentials come from

SDKs and the CLI look for credentials in a fixed order and use the first they find:

1. command-line options (`--profile`)
2. environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_PROFILE`)
3. the shared credentials/config files (`~/.aws/…`), including SSO profiles
4. container credentials (ECS task role)
5. instance metadata (EC2 instance profile role)

In AWS, your code should get credentials from **roles** (cases 4 and 5) automatically. Never hard-code keys, and never bake them into images.

### Useful CLI flags

- `--query` filters output with JMESPath: `aws ec2 describe-instances --query 'Reservations[].Instances[].InstanceId' --output text`
- `--output json|table|text|yaml`
- `--region` overrides the profile's region
- `--dry-run` (EC2) checks permissions without doing anything
- `--no-cli-pager` for scripts

## ARNs

Every resource has an **Amazon Resource Name**:

```
arn:partition:service:region:account-id:resource
arn:aws:s3:::acme-invoices                             # S3 bucket: no region or account
arn:aws:s3:::acme-invoices/2026/*                      # objects under a prefix
arn:aws:iam::123456789012:role/github-deploy          # IAM: global, no region
arn:aws:lambda:eu-west-1:123456789012:function:resize
arn:aws:dynamodb:eu-west-1:123456789012:table/Orders
```

ARNs are how policies name resources, so you'll read and write them constantly.

## Tags

Tags are key/value labels on resources: `Environment=prod`, `Team=payments`, `CostCenter=1234`, `Service=checkout`. Use them consistently for **cost allocation**, automation (backup everything tagged `Backup=daily`), and access control (attribute-based policies). Enforce required tags with tag policies or in your infrastructure-as-code.

## The Well-Architected Framework

AWS's checklist for good designs has six pillars: **operational excellence**, **security**, **reliability**, **performance efficiency**, **cost optimization** and **sustainability**. Each lesson in this track maps to them: IAM to security, multi-AZ to reliability, right-sizing to cost.

:::quiz
q: What is an Availability Zone?
- a country
+ one or more isolated data centers within a region, with independent power and networking
- a CDN location
- a separate AWS account
why: Deploying across several AZs protects against a data-center failure.
:::

:::quiz
q: Under the shared responsibility model, who patches the operating system of an EC2 instance?
+ the customer
- AWS
- nobody; EC2 is patched automatically
- AWS Support
why: EC2 is infrastructure as a service: the guest OS is yours.
:::

:::quiz
q: What should you do with the root user?
- use it for daily administration
- create access keys for automation
+ enable MFA, lock it away, and use IAM roles or Identity Center users instead
- delete it
why: Root has unlimited power and can't be restricted by IAM policies.
:::

:::quiz
q: Code running on EC2 needs AWS credentials. Where should they come from?
- environment variables set in the AMI
- a credentials file baked into the image
+ an IAM role attached to the instance (instance profile)
- the developer's access keys
why: Roles provide temporary, automatically rotated credentials via the instance metadata service.
:::

:::exercise
id: af-whoami
level: 1
title: Who am I?
mode: code
lang: bash
file: check.sh
---
Write the AWS CLI command that shows which account and identity your current credentials belong to, using the profile `staging`.
---starter
#!/bin/sh
---rule
aws\s+sts\s+get-caller-identity
`aws sts get-caller-identity`
---rule
--profile[ =]staging
`--profile staging`
---solution
#!/bin/sh
aws sts get-caller-identity --profile staging
:::

:::exercise
id: af-query
level: 2
title: Filter with --query
mode: code
lang: bash
file: list.sh
---
List only the **instance IDs** of all EC2 instances in `eu-west-1`, as plain text, using `describe-instances` with a JMESPath `--query` of `Reservations[].Instances[].InstanceId`.
---starter
#!/bin/sh
---rule
aws\s+ec2\s+describe-instances
`aws ec2 describe-instances`
---rule
--query[ =]["']Reservations\[\]\.Instances\[\]\.InstanceId["']
`--query 'Reservations[].Instances[].InstanceId'`
---rule
--output[ =]text
`--output text`
---rule
--region[ =]eu-west-1
`--region eu-west-1`
---solution
#!/bin/sh
aws ec2 describe-instances --region eu-west-1 --query 'Reservations[].Instances[].InstanceId' --output text
:::

:::exercise
id: af-profile
level: 2
title: An SSO profile
mode: code
lang: properties
file: ~/.aws/config
---
Add a profile `prod` to `~/.aws/config` that uses the SSO session `acme`, account `222222222222`, role `ReadOnly`, and region `eu-west-1`.
---starter
[sso-session acme]
sso_start_url = https://acme.awsapps.com/start
sso_region = eu-west-1
---rule
^\[profile prod\]\s*$
`[profile prod]`
---rule
^sso_session\s*=\s*acme\s*$
`sso_session = acme`
---rule
^sso_account_id\s*=\s*222222222222\s*$
`sso_account_id = 222222222222`
---rule
^sso_role_name\s*=\s*ReadOnly\s*$
`sso_role_name = ReadOnly`
---rule
\[profile prod\][\s\S]*^region\s*=\s*eu-west-1\s*$
`region = eu-west-1` in the profile
---solution
[sso-session acme]
sso_start_url = https://acme.awsapps.com/start
sso_region = eu-west-1

[profile prod]
sso_session = acme
sso_account_id = 222222222222
sso_role_name = ReadOnly
region = eu-west-1
:::

:::exercise
id: af-arn-role
level: 2
title: Write an ARN
mode: answer
---
Write the ARN of the IAM role `app-runtime` in account `123456789012`.
---answer
arn:aws:iam::123456789012:role/app-runtime
---solution
arn:aws:iam::123456789012:role/app-runtime
---explain
IAM is global, so the region field is empty: two colons in a row.
:::

:::exercise
id: af-arn-bucket
level: 2
title: Objects under a prefix
mode: answer
---
Write the ARN that matches **every object** under the prefix `reports/` in the S3 bucket `acme-data`.
---answer
arn:aws:s3:::acme-data/reports/*
---solution
arn:aws:s3:::acme-data/reports/*
:::

:::exercise
id: af-precedence
level: 3
title: Which credentials win?
mode: answer
---
`~/.aws/credentials` has a `[default]` profile for account A. The shell also has `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` set for account B. You run `aws s3 ls` with no `--profile`. Which account's credentials are used? Answer `A` or `B`.
---answer
B
---solution
B
---explain
Environment variables come before the shared credentials file in the resolution chain. This surprises people constantly; `aws sts get-caller-identity` tells you the truth.
:::

:::exercise
id: af-scope
level: 2
title: Regional, global or zonal?
mode: answer
---
Is an **EBS volume** regional, global, or zonal (tied to one AZ)?
---answer
zonal
---answer
az
---answer
availability zone
---solution
zonal
---explain
An EBS volume lives in one AZ and can only attach to instances in that AZ. Snapshots (stored in S3) are regional and can be copied across regions.
:::
