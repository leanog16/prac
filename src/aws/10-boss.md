---
id: aws-boss
title: Boss round: architecture & incidents
summary: Design and debug like a cloud engineer: least-privilege policies for a real service, a secure network path, a serverless pipeline with failure handling, cross-account access, cost and security incidents, and architecture choices with trade-offs.
minutes: 60
---
> [!project] Taskboard, final step: production incidents
> Taskboard is live on AWS. The boss round's project exercises are incidents from its first month in production. Each has a root cause in a lesson you've done.

## A reference architecture

Most web applications on AWS converge on a shape like this:

```
Route 53 ──► CloudFront ──► S3 (static frontend, private, OAC)
                 │
                 └──► ALB (public subnets, ACM certificate, WAF)
                        │
                        ▼
                ECS Fargate service (private subnets, 2+ AZs, autoscaling)
                   │            │               │
                   ▼            ▼               ▼
        RDS PostgreSQL     ElastiCache      SQS ──► worker (ECS or Lambda) ──► DLQ + alarm
        (Multi-AZ,         (sessions,
         isolated subnets)  cache)
Secrets Manager · CloudWatch logs/metrics/alarms · CloudTrail · IaC (CDK/Terraform) · CI/CD with OIDC
```

## Incident playbook

| Symptom | First checks |
|---|---|
| `AccessDenied` | `sts get-caller-identity`; identity policy **and** resource policy; KMS key policy; SCPs; CloudTrail event for the exact action |
| Can't connect (timeout) | route tables, security groups (both ends), NACLs, is anything listening; Reachability Analyzer |
| Connection **refused** | the network path works but nothing is listening on that port |
| 502/503 from ALB | target group health checks, task/instance logs, health check path and port, security group from ALB to targets |
| ECS tasks keep restarting | stopped reason, container logs, health check grace period, memory limit (exit 137) |
| Lambda timeouts | downstream latency, VPC egress (NAT/endpoints), cold starts, timeout vs SQS visibility |
| Messages stuck or duplicated | visibility timeout, DLQ, idempotency, batch failure reporting |
| Bill spiked | Cost Explorer by service and tag: NAT data, data transfer, logs, forgotten resources |

## Worked example: an incident write-up

Good teams write a short, blameless **post-incident review** after every outage. Taskboard's first one:

> **Summary.** For 23 minutes, 40% of `PATCH /tasks` requests returned 502.
>
> **Timeline.** 10:02 deploy of `sha-9c1e2f0` starts · 10:05 5xx alarm fires · 10:09 on-call sees new tasks flapping between healthy and unhealthy · 10:21 identified · 10:25 rolled back to `sha-3f2c1ab` · 10:25 errors stop.
>
> **Root cause.** The new image added a database migration at startup that took ~70 s. The target group health check (5 s interval, 2 failures) marked tasks unhealthy and ECS killed them before startup finished, so they never became stable. The circuit breaker was disabled on this service.
>
> **What went well.** The alarm fired within 3 minutes. Rollback was a single command.
>
> **Action items.** Run migrations as a separate one-off task before deploying (owner: Ana). Set `healthCheckGracePeriodSeconds` to 120. Enable the deployment circuit breaker on every service. Add "startup time" to the load test.

Notice the review blames a **process and a configuration**, not a person, and every action item makes this class of failure impossible or detectable. That's how systems get more reliable over time.

:::exercise
id: ab-policy
level: 4
title: Least privilege for a real service
mode: code
lang: json
file: task-role-policy.json
---
The `orders` service's task role needs exactly: read/write items in DynamoDB table `Orders` (`GetItem`, `PutItem`, `UpdateItem`, `Query`) in `eu-west-1`, account `123456789012`, **including its indexes** (`table/Orders/index/*`); send messages to SQS queue `order-events` (same region and account); and read objects under `invoices/` in bucket `acme-invoices`. Write the policy with one statement per service and no wildcards in actions.
---starter
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}
---rule
"dynamodb:GetItem"[\s\S]*?"dynamodb:PutItem"[\s\S]*?"dynamodb:UpdateItem"[\s\S]*?"dynamodb:Query"|"dynamodb:Query"[\s\S]*?"dynamodb:GetItem"
The four DynamoDB actions
---rule
"arn:aws:dynamodb:eu-west-1:123456789012:table/Orders"
The table ARN
---rule
"arn:aws:dynamodb:eu-west-1:123456789012:table/Orders/index/\*"
Its indexes
---rule
"sqs:SendMessage"
`sqs:SendMessage`
---rule
"arn:aws:sqs:eu-west-1:123456789012:order-events"
The queue ARN
---rule
"s3:GetObject"
`s3:GetObject`
---rule
"arn:aws:s3:::acme-invoices/invoices/\*"
Only objects under `invoices/`
---rule
!"Action"\s*:\s*"\*"|"Resource"\s*:\s*"\*"|"[a-z0-9]+:\*"
No wildcard actions or resources
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OrdersTable",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"],
      "Resource": [
        "arn:aws:dynamodb:eu-west-1:123456789012:table/Orders",
        "arn:aws:dynamodb:eu-west-1:123456789012:table/Orders/index/*"
      ]
    },
    {
      "Sid": "OrderEvents",
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:eu-west-1:123456789012:order-events"
    },
    {
      "Sid": "ReadInvoices",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::acme-invoices/invoices/*"
    }
  ]
}
:::

:::exercise
id: ab-cross-account
level: 4
title: Cross-account read
mode: code
lang: json
file: bucket-policy.json
---
The analytics account `222222222222` has a role `arn:aws:iam::222222222222:role/analytics-reader` that must **list** bucket `acme-exports` (in your account) and **read** its objects. Write the **bucket policy** that grants exactly that.
---starter
{
  "Version": "2012-10-17",
  "Statement": []
}
---rule
"Principal"\s*:\s*\{\s*"AWS"\s*:\s*"arn:aws:iam::222222222222:role/analytics-reader"\s*\}
Principal: the analytics role
---rule
"s3:ListBucket"[\s\S]*?"Resource"\s*:\s*"arn:aws:s3:::acme-exports"\s*\}|"Resource"\s*:\s*"arn:aws:s3:::acme-exports"\s*,?[\s\S]*?"s3:ListBucket"
`s3:ListBucket` on the bucket ARN
---rule
"s3:GetObject"[\s\S]*?"arn:aws:s3:::acme-exports/\*"|"arn:aws:s3:::acme-exports/\*"[\s\S]*?"s3:GetObject"
`s3:GetObject` on the objects
---rule
!"Principal"\s*:\s*"\*"
No public principal
---rule
!"s3:\*"
No `s3:*`
---solution
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListExports",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::222222222222:role/analytics-reader" },
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::acme-exports"
    },
    {
      "Sid": "ReadExports",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::222222222222:role/analytics-reader" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::acme-exports/*"
    }
  ]
}
:::

:::exercise
id: ab-idempotent-worker
level: 4
title: A safe queue worker
mode: code
lang: python
file: worker.py
---
Payments are being charged twice when SQS redelivers a message. Fix the worker: for each record, parse the body, then **claim** the payment with `processed.put_item(Item={"payment_id": msg["payment_id"]}, ConditionExpression="attribute_not_exists(payment_id)")`. If that raises `ClientError` with code `ConditionalCheckFailedException`, skip the record (already done). Only then call `charge(msg)`. Any other exception marks the record as failed in `batchItemFailures`.
---starter
import json

import boto3
from botocore.exceptions import ClientError

processed = boto3.resource("dynamodb").Table("ProcessedPayments")


def handler(event, context):
    for record in event["Records"]:
        msg = json.loads(record["body"])
        charge(msg)
---rule
failures\s*=\s*\[\s*\]
Collect failures
---rule
processed\.put_item\(\s*Item\s*=\s*\{\s*["']payment_id["']\s*:\s*msg\[\s*["']payment_id["']\s*\]\s*\}\s*,\s*ConditionExpression\s*=\s*["']attribute_not_exists\(payment_id\)["']\s*\)
Conditional claim on `payment_id`
---rule
except\s+ClientError\s+as\s+e\s*:\s*\n\s+if\s+e\.response\[\s*["']Error["']\s*\]\[\s*["']Code["']\s*\]\s*==\s*["']ConditionalCheckFailedException["']\s*:\s*\n\s+continue
Skip duplicates
---rule
put_item[\s\S]*charge\(\s*msg\s*\)
Charge only after claiming
---rule
failures\.append\(\s*\{\s*["']itemIdentifier["']\s*:\s*record\[\s*["']messageId["']\s*\]\s*\}\s*\)
Report other failures
---rule
return\s*\{\s*["']batchItemFailures["']\s*:\s*failures\s*\}
Return `batchItemFailures`
---solution
import json

import boto3
from botocore.exceptions import ClientError

processed = boto3.resource("dynamodb").Table("ProcessedPayments")


def handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            msg = json.loads(record["body"])
            try:
                processed.put_item(Item={"payment_id": msg["payment_id"]}, ConditionExpression="attribute_not_exists(payment_id)")
            except ClientError as e:
                if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                    continue
                raise
            charge(msg)
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
:::

:::exercise
id: ab-public-bucket
level: 3
title: Incident: public bucket
mode: code
lang: bash
file: contain.sh
---
A scanner reports that bucket `acme-backups` is publicly readable. Contain it immediately: turn on **all four** Block Public Access settings for the bucket with `s3api put-public-access-block`, then delete its bucket policy.
---starter
#!/bin/sh
set -e
---rule
aws\s+s3api\s+put-public-access-block\s+(?=[^\n]*--bucket[ =]acme-backups)
`put-public-access-block --bucket acme-backups`
---rule
BlockPublicAcls=true
`BlockPublicAcls=true`
---rule
IgnorePublicAcls=true
`IgnorePublicAcls=true`
---rule
BlockPublicPolicy=true
`BlockPublicPolicy=true`
---rule
RestrictPublicBuckets=true
`RestrictPublicBuckets=true`
---rule
aws\s+s3api\s+delete-bucket-policy\s+--bucket[ =]acme-backups
`aws s3api delete-bucket-policy --bucket acme-backups`
---solution
#!/bin/sh
set -e
aws s3api put-public-access-block --bucket acme-backups \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api delete-bucket-policy --bucket acme-backups
:::

:::exercise
id: ab-leaked-key
level: 3
title: Incident: leaked access key
mode: code
lang: bash
file: revoke.sh
---
An access key `AKIAEXAMPLEKEY123456` for IAM user `ci-legacy` was pushed to a public repository. First **deactivate** it (so you can investigate without losing it), then **delete** it.
---starter
#!/bin/sh
set -e
---rule
aws\s+iam\s+update-access-key\s+(?=[^\n]*--user-name[ =]ci-legacy)(?=[^\n]*--access-key-id[ =]AKIAEXAMPLEKEY123456)(?=[^\n]*--status[ =]Inactive)
Deactivate the key
---rule
aws\s+iam\s+delete-access-key\s+(?=[^\n]*--user-name[ =]ci-legacy)(?=[^\n]*--access-key-id[ =]AKIAEXAMPLEKEY123456)
Delete it
---rule
update-access-key[\s\S]*delete-access-key
Deactivate first
---solution
#!/bin/sh
set -e
aws iam update-access-key --user-name ci-legacy --access-key-id AKIAEXAMPLEKEY123456 --status Inactive
aws iam delete-access-key --user-name ci-legacy --access-key-id AKIAEXAMPLEKEY123456
:::

:::exercise
id: ab-502
level: 3
title: Incident: 502 from the ALB
mode: answer
---
After a deploy, the ALB returns 502/503 and the target group shows all targets **unhealthy**. Container logs show the app started fine and is listening on port **8000**. The target group health check is `HTTP /health` on port **80**. What's wrong? (Answer with the port the health check should use.)
---answer
8000
---solution
8000
---explain
The health check probes a port nothing listens on, so every target fails and the ALB has nowhere to send traffic. Use the traffic port (8000).
:::

:::exercise
id: ab-refused-vs-timeout
level: 3
title: Timeout or refused?
mode: answer
---
From an app container, `curl db.internal:5432` **hangs and times out**. Is the problem more likely the network path/firewall, or nothing listening on the port? Answer `network` or `listener`.
---answer
network
---solution
network
---explain
A timeout means packets are dropped (security group, NACL, route). "Connection refused" would mean the host was reached but nothing listens on that port.
:::

:::exercise
id: ab-design
level: 4
title: Choose the architecture
mode: answer
---
A startup needs an image-thumbnail feature: users upload photos (bursty: zero most of the night, thousands per minute after a marketing email), and thumbnails must be ready within a minute. The team is two developers and wants no servers to patch. Which compute service should generate the thumbnails, triggered by S3 uploads?
---answer
Lambda
---answer
AWS Lambda
---solution
Lambda
---explain
Event-driven, bursty, short tasks, and no server management: S3 event → (optionally SQS for buffering and retries) → Lambda, with a DLQ and an alarm.
:::

:::exercise
id: proj-aws-10-grace
level: 3
title: "Project 10: give startup some room"
mode: code
lang: bash
file: fix-service.sh
---
Apply two action items from the review to service `taskboard-api` in cluster `taskboard`: set the health check grace period to **120** seconds, and enable the deployment circuit breaker **with rollback**.
---starter
#!/bin/sh
---rule
aws\s+ecs\s+update-service
`aws ecs update-service`
---rule
--cluster[ =]taskboard\b
Cluster
---rule
--service[ =]taskboard-api
Service
---rule
--health-check-grace-period-seconds[ =]120
Grace period 120 s
---rule
deploymentCircuitBreaker=\{enable=true,rollback=true\}
Circuit breaker with rollback
---solution
#!/bin/sh
aws ecs update-service --cluster taskboard --service taskboard-api \
  --health-check-grace-period-seconds 120 \
  --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}"
:::

:::exercise
id: proj-aws-10-presign-denied
level: 3
title: "Project 10b: uploads fail with AccessDenied"
mode: answer
---
Browsers get `403 AccessDenied` when PUTting to presigned URLs that the Taskboard API generates. The task role allows only `s3:GetObject` and `s3:DeleteObject` on `taskboard-attachments-prod/tasks/*`. Which action is missing from the task role?
---answer
s3:PutObject
---solution
s3:PutObject
---explain
A presigned URL carries the permissions of the identity that signed it. The API's role must itself be allowed to `PutObject` on that key.
:::

:::exercise
id: proj-aws-10-nat-bill
level: 3
title: "Project 10c: the NAT bill"
mode: answer
---
Taskboard's monthly bill shows a large "NAT Gateway data processing" charge. Most of the traffic is ECS tasks pulling images from ECR and the API reading and writing attachments in S3. What should you add so S3 traffic stops going through the NAT gateway? (Three words: the type of endpoint.)
---answer
S3 gateway endpoint
---answer
gateway VPC endpoint
---answer
gateway endpoint
---answer
VPC gateway endpoint
---solution
S3 gateway endpoint
---explain
A gateway endpoint for S3 is free and routes S3 traffic privately. ECR also needs interface endpoints (ecr.api, ecr.dkr), whose layers are served from S3 too.
:::
