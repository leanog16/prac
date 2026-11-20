---
id: aws-iam
title: IAM & policies
summary: Users, groups, roles and IAM Identity Center; identity-based and resource-based policies; the JSON policy grammar (Effect, Action, Resource, Condition); evaluation logic with explicit deny; least privilege; trust policies and AssumeRole; instance profiles; permission boundaries; and debugging AccessDenied.
minutes: 45
---
> [!project] Taskboard, step 2: one role per component
> Every piece of Taskboard gets its own identity with exactly the permissions it needs: the API's task role, ECS's execution role, the notify Lambda's role, and the CI deploy role.

## Identities

| Identity | Is | Credentials | Use for |
|---|---|---|---|
| **IAM user** | a long-lived identity in one account | password and/or access keys (long-lived) | legacy, break-glass, a few third-party tools |
| **IAM group** | a set of users sharing policies | — | managing users at scale |
| **IAM role** | an identity **assumed** temporarily by someone or something | short-lived (minutes to hours), auto-rotated | **everything else**: apps on EC2/ECS/Lambda, CI/CD via OIDC, cross-account access, humans via SSO |
| **IAM Identity Center** (SSO) | central sign-in for people across all accounts | temporary role credentials | human access |

The modern rule: **humans sign in through Identity Center, workloads use roles, and nobody has long-lived access keys** unless there's no alternative.

## Policies

A **policy** is a JSON document of permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadInvoices",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::acme-invoices",
        "arn:aws:s3:::acme-invoices/*"
      ]
    },
    {
      "Sid": "WriteOnlyFromVpc",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::acme-invoices/uploads/*",
      "Condition": {
        "StringEquals": { "aws:SourceVpce": "vpce-0a1b2c3d" }
      }
    }
  ]
}
```

| Element | Meaning |
|---|---|
| `Version` | always `"2012-10-17"` (the policy language version, not a date you edit) |
| `Effect` | `Allow` or `Deny` |
| `Action` | API operations, `service:Operation`; wildcards allowed (`s3:Get*`) |
| `Resource` | ARNs the statement applies to |
| `Condition` | optional extra checks: source IP, VPC endpoint, MFA, tags, time, encryption |
| `Principal` | **who**: only in resource-based and trust policies |

Note the S3 detail: `ListBucket` applies to the **bucket** ARN; `GetObject`/`PutObject` apply to **object** ARNs (`bucket/*`). Getting this wrong is the most common S3 AccessDenied.

### Kinds of policies

- **Identity-based**: attached to a user, group or role. "This role may read that bucket."
- **Resource-based**: attached to the resource, with a `Principal`. S3 bucket policies, SQS queue policies, KMS key policies, Lambda resource policies. "This bucket may be read by that role (even from another account)."
- **AWS managed** policies (`ReadOnlyAccess`, `AmazonS3ReadOnlyAccess`) are convenient but broad. **Customer managed** policies let you scope to exactly your resources.

## How AWS decides

For each request, AWS evaluates all applicable policies:

1. **Default: deny.** Nothing is allowed unless something allows it.
2. Any explicit **`Deny`** that matches wins, always, over any number of allows.
3. An applicable allow is needed, but evaluation depends on the principal and resource: cross-account requests generally require allows on both sides, and boundaries, session policies and SCPs can limit permissions. Resource-policy grants to some principal types have special rules.

So "explicit deny > explicit allow > implicit deny". Use explicit denies for guardrails ("never delete the audit bucket", "deny everything without MFA").

## Least privilege

Grant only the actions and resources needed, then tighten further:

- Start specific (`dynamodb:GetItem` on one table), not `dynamodb:*` on `*`.
- Use **IAM Access Analyzer** to generate policies from actual CloudTrail activity and to find resources shared outside your account.
- Review **last accessed** data and remove unused permissions.
- `"Action": "*", "Resource": "*"` (AdministratorAccess) belongs only to a small break-glass role.

## Roles and trust policies

A role has **two** policies:

- a **permissions policy**: what the role can do;
- a **trust policy**: who may **assume** the role.

```json title=trust policy for an EC2 app role
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

Common principals: `{"Service": "lambda.amazonaws.com"}`, `{"Service": "ecs-tasks.amazonaws.com"}`, `{"AWS": "arn:aws:iam::111111111111:root"}` (another account), and `{"Federated": "…oidc-provider/token.actions.githubusercontent.com"}` (GitHub OIDC, from the CI/CD track).

Assuming a role returns temporary credentials:

```bash
aws sts assume-role --role-arn arn:aws:iam::222222222222:role/auditor --role-session-name alice
```

The CLI does this automatically for profiles with `role_arn` and `source_profile`.

### Instance profiles, task roles, execution roles

- **EC2**: attach a role through an **instance profile**; the SDK picks up its credentials from the instance metadata service (use IMDSv2).
- **ECS**: the **task role** is what your app code can do; the **task execution role** is what ECS itself needs to pull the image from ECR and write logs.
- **Lambda**: the **execution role** is what the function can do (at minimum, write CloudWatch Logs).

## Guardrails above IAM

- **SCPs** (Organizations) cap what any identity in an account can do, root included.
- **Permission boundaries** cap what a role can be granted, which lets developers create roles for their apps without being able to escalate their own privileges.
- These guardrails limit permissions, but the precise evaluation also depends on resource policies and the principal type.

## Debugging AccessDenied

1. `aws sts get-caller-identity`: are you who you think you are?
2. Read the error. Many services now say which policy type denied (`with an explicit deny in a service control policy`, `because no identity-based policy allows the s3:GetObject action`).
3. Check both sides: identity policy **and** resource policy (bucket policy, KMS key policy). For KMS-encrypted data you need `kms:Decrypt` on the key too.
4. Use the **IAM Policy Simulator** or `aws iam simulate-principal-policy`.
5. Look up the request in **CloudTrail** for the exact action, resource and error code.

## Worked example: deriving the API's policy from its code

Read through Taskboard's code and list every AWS call it makes:

| Code path | AWS call | Action | Resource |
|---|---|---|---|
| upload attachment | `put_object` / presigned PUT | `s3:PutObject` | `taskboard-attachments-prod/tasks/*` |
| download attachment | presigned GET | `s3:GetObject` | same |
| delete task → delete files | `delete_object` | `s3:DeleteObject` | same |
| task moved → event | `send_message` | `sqs:SendMessage` | `task-events` queue |
| startup → secrets | `get_secret_value` | `secretsmanager:GetSecretValue` | `taskboard/prod/*` |

That table **is** the policy. Anything not in it (listing all buckets, reading other queues, deleting the bucket) isn't granted. If someone finds a remote-code-execution bug in Taskboard, the damage is limited to these five actions.

Keep the table in the repository next to the IaC. When a code change adds an AWS call, the review shows both the code and the permission change.

> [!plain] In plain English
> Least privilege means writing down what a component actually does, and granting exactly that. When in doubt, deny; a missing permission shows up as a clear `AccessDenied` you can fix in minutes.

## Common mistakes

> [!mistake] Sharing one role across components
> If the Lambda and the API share a role, the Lambda can read attachments and the API can do whatever the Lambda can. Separate roles keep each blast radius small, and CloudTrail shows exactly who did what.

:::quiz
q: A user has a policy allowing `s3:*` on a bucket and another policy denying `s3:DeleteObject` on it. Can they delete objects?
- yes, the allow is broader
+ no, an explicit deny always wins
- only with MFA
- it depends on policy order
why: Explicit deny overrides any allow.
:::

:::quiz
q: Which policy element appears in resource-based policies but not in identity-based ones?
- Action
- Effect
+ Principal
- Condition
why: An identity policy's principal is whoever it's attached to; a resource policy must name who it grants access to.
:::

:::quiz
q: What does a role's trust policy define?
+ who is allowed to assume the role
- what the role can do
- which regions the role works in
- how long sessions last
why: Permissions policy = what; trust policy = who can become the role.
:::

:::quiz
q: In ECS, which role does your application code use to call DynamoDB?
- the task execution role
+ the task role
- the EC2 instance role of the cluster host
- the service-linked role
why: The execution role is for ECS itself (pulling images, logs); the task role is for your code.
:::

:::quiz
q: A role allows `s3:GetObject` on `arn:aws:s3:::reports`. Downloading `reports/q1.pdf` fails. Why?
- GetObject needs ListBucket too
+ object actions need object ARNs: `arn:aws:s3:::reports/*`
- the bucket must be public
- S3 doesn't support roles
why: The bucket ARN and the object ARNs are different resources.
:::

:::exercise
id: ai-read-bucket
level: 2
title: Read-only access to one bucket
mode: code
lang: json
file: policy.json
---
Write an identity policy that allows **listing** the bucket `acme-reports` and **reading** any object in it, nothing else.
---starter
{
  "Version": "2012-10-17",
  "Statement": []
}
---rule
"Version"\s*:\s*"2012-10-17"
`"Version": "2012-10-17"`
---rule
"Effect"\s*:\s*"Allow"
An `Allow` statement
---rule
"s3:ListBucket"[\s\S]*?"Resource"\s*:\s*(\[\s*)?"arn:aws:s3:::acme-reports"|"Resource"\s*:\s*"arn:aws:s3:::acme-reports"\s*[\s\S]*?"s3:ListBucket"
`s3:ListBucket` on `arn:aws:s3:::acme-reports`
---rule
"s3:GetObject"
`s3:GetObject`
---rule
"arn:aws:s3:::acme-reports/\*"
Objects: `arn:aws:s3:::acme-reports/*`
---rule
!"s3:\*"|"Action"\s*:\s*"\*"
No wildcards like `s3:*`
---rule
!"Resource"\s*:\s*"\*"
No `"Resource": "*"`
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::acme-reports"
    },
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::acme-reports/*"
    }
  ]
}
:::

:::exercise
id: ai-dynamo
level: 2
title: Scoped DynamoDB access
mode: code
lang: json
file: policy.json
---
Allow `dynamodb:GetItem`, `dynamodb:PutItem` and `dynamodb:Query` on the table `Orders` in `eu-west-1`, account `123456789012`, only.
---starter
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "dynamodb:*",
      "Resource": "*"
    }
  ]
}
---rule
"dynamodb:GetItem"
`dynamodb:GetItem`
---rule
"dynamodb:PutItem"
`dynamodb:PutItem`
---rule
"dynamodb:Query"
`dynamodb:Query`
---rule
"arn:aws:dynamodb:eu-west-1:123456789012:table/Orders"
The table ARN
---rule
!"dynamodb:\*"
No `dynamodb:*`
---rule
!"Resource"\s*:\s*"\*"
No `"Resource": "*"`
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"],
      "Resource": "arn:aws:dynamodb:eu-west-1:123456789012:table/Orders"
    }
  ]
}
:::

:::exercise
id: ai-deny
level: 3
title: A guardrail deny
mode: code
lang: json
file: policy.json
---
Add a second statement that **explicitly denies** `s3:DeleteBucket` and `s3:DeleteObject` on `arn:aws:s3:::acme-audit-logs` and `arn:aws:s3:::acme-audit-logs/*`, so no allow anywhere can override it.
---starter
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": "*"
    }
  ]
}
---rule
"Effect"\s*:\s*"Deny"
A `Deny` statement
---rule
"s3:DeleteBucket"
`s3:DeleteBucket`
---rule
"s3:DeleteObject"
`s3:DeleteObject`
---rule
"arn:aws:s3:::acme-audit-logs"\s*[,\]]
The bucket ARN
---rule
"arn:aws:s3:::acme-audit-logs/\*"
The objects ARN
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": "*"
    },
    {
      "Effect": "Deny",
      "Action": ["s3:DeleteBucket", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::acme-audit-logs",
        "arn:aws:s3:::acme-audit-logs/*"
      ]
    }
  ]
}
:::

:::exercise
id: ai-trust-lambda
level: 2
title: A trust policy for Lambda
mode: code
lang: json
file: trust.json
---
Write the trust policy that lets the **Lambda service** assume the role.
---starter
{
  "Version": "2012-10-17",
  "Statement": []
}
---rule
"Effect"\s*:\s*"Allow"
`Allow`
---rule
"Principal"\s*:\s*\{\s*"Service"\s*:\s*"lambda\.amazonaws\.com"\s*\}
`"Principal": {"Service": "lambda.amazonaws.com"}`
---rule
"Action"\s*:\s*"sts:AssumeRole"
`"Action": "sts:AssumeRole"`
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
:::

:::exercise
id: ai-mfa-condition
level: 3
title: Require MFA
mode: code
lang: json
file: policy.json
---
Allow `ec2:StopInstances` and `ec2:TerminateInstances` on all resources **only** when the caller signed in with MFA, using the condition key `aws:MultiFactorAuthPresent` with `Bool` set to `"true"`.
---starter
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ec2:StopInstances", "ec2:TerminateInstances"],
      "Resource": "*"
    }
  ]
}
---rule
"Condition"\s*:\s*\{\s*"Bool"\s*:\s*\{\s*"aws:MultiFactorAuthPresent"\s*:\s*"true"\s*\}\s*\}
`"Condition": {"Bool": {"aws:MultiFactorAuthPresent": "true"}}`
---rule
"ec2:StopInstances"[\s\S]*"ec2:TerminateInstances"
Both actions
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ec2:StopInstances", "ec2:TerminateInstances"],
      "Resource": "*",
      "Condition": {
        "Bool": { "aws:MultiFactorAuthPresent": "true" }
      }
    }
  ]
}
:::

:::exercise
id: ai-assume
level: 2
title: Assume a role from the CLI
mode: code
lang: bash
file: assume.sh
---
Write the CLI command that assumes the role `arn:aws:iam::222222222222:role/auditor` with the session name `audit-2026`.
---starter
#!/bin/sh
---rule
aws\s+sts\s+assume-role
`aws sts assume-role`
---rule
--role-arn[ =]arn:aws:iam::222222222222:role/auditor
`--role-arn arn:aws:iam::222222222222:role/auditor`
---rule
--role-session-name[ =]audit-2026
`--role-session-name audit-2026`
---solution
#!/bin/sh
aws sts assume-role --role-arn arn:aws:iam::222222222222:role/auditor --role-session-name audit-2026
:::

:::exercise
id: ai-evaluate
level: 3
title: Predict: allowed or denied?
mode: answer
---
A role's identity policy allows `sqs:SendMessage` on queue `Q`. The account's SCP allows only `s3:*` and `dynamodb:*`. Is `sqs:SendMessage` on `Q` allowed? Answer `allowed` or `denied`.
---answer
denied
---solution
denied
---explain
An SCP is a ceiling: effective permissions are the intersection of the SCP and the identity policy, and SQS isn't in the SCP.
:::

:::exercise
id: ai-which-role
level: 2
title: Which ECS role?
mode: answer
---
An ECS task fails to start with `CannotPullContainerError: ... not authorized to perform: ecr:GetAuthorizationToken`. Which role is missing the permission: the **task role** or the **task execution role**?
---answer
task execution role
---answer
execution role
---solution
task execution role
:::

:::exercise
id: proj-aws-02-api-policy
level: 4
title: "Project 2: the API task role policy"
mode: code
lang: json
file: taskboard-api-policy.json
path: infra/aws/taskboard-api-policy.json
---
Write the API task role's policy from the table: `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::taskboard-attachments-prod/tasks/*`; `sqs:SendMessage` on `arn:aws:sqs:eu-west-1:222222222222:task-events`; `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/*`. No wildcard actions.
---starter
{
  "Version": "2012-10-17",
  "Statement": []
}
---rule
"s3:PutObject"
`s3:PutObject`
---rule
"s3:GetObject"
`s3:GetObject`
---rule
"s3:DeleteObject"
`s3:DeleteObject`
---rule
"arn:aws:s3:::taskboard-attachments-prod/tasks/\*"
Only the `tasks/` prefix
---rule
"sqs:SendMessage"[\s\S]*?"arn:aws:sqs:eu-west-1:222222222222:task-events"|"arn:aws:sqs:eu-west-1:222222222222:task-events"[\s\S]*?"sqs:SendMessage"
Send to `task-events`
---rule
"secretsmanager:GetSecretValue"[\s\S]*?"arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/\*"|"arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/\*"[\s\S]*?"secretsmanager:GetSecretValue"
Read Taskboard's secrets
---rule
!"[a-z0-9]+:\*"|"Action"\s*:\s*"\*"|"Resource"\s*:\s*"\*"
No wildcard actions or resources
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Attachments",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::taskboard-attachments-prod/tasks/*"
    },
    {
      "Sid": "TaskEvents",
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:eu-west-1:222222222222:task-events"
    },
    {
      "Sid": "Secrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/*"
    }
  ]
}
:::

:::exercise
id: proj-aws-02-trust
level: 3
title: "Project 2b: trust ECS tasks"
mode: code
lang: json
file: taskboard-api-trust.json
path: infra/aws/taskboard-api-trust.json
---
Write the trust policy for the API task role so that **ECS tasks** (`ecs-tasks.amazonaws.com`) can assume it.
---starter
{
  "Version": "2012-10-17",
  "Statement": []
}
---rule
"Effect"\s*:\s*"Allow"
`Allow`
---rule
"Principal"\s*:\s*\{\s*"Service"\s*:\s*"ecs-tasks\.amazonaws\.com"\s*\}
ECS tasks principal
---rule
"Action"\s*:\s*"sts:AssumeRole"
`sts:AssumeRole`
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
:::
