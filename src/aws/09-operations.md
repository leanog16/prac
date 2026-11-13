---
id: aws-ops
title: Observability, IaC & cost
summary: CloudWatch metrics, logs, Logs Insights queries and alarms, X-Ray tracing, CloudTrail for auditing, AWS Config and GuardDuty; infrastructure as code with CloudFormation, CDK and Terraform (state, plan, drift); and cost control with budgets, tagging, right-sizing and the usual surprise charges.
minutes: 45
---
## CloudWatch: metrics, logs, alarms

**Metrics** are time series. AWS services publish them automatically (EC2 `CPUUtilization`, ALB `HTTPCode_Target_5XX_Count` and `TargetResponseTime`, Lambda `Errors`/`Duration`/`Throttles`, SQS `ApproximateAgeOfOldestMessage`, RDS `FreeStorageSpace`). Publish your own business metrics too (orders placed, payment failures), via the SDK, the CloudWatch agent, or the Embedded Metric Format in log lines.

**Logs** are organized into **log groups** (`/ecs/shop-api`, `/aws/lambda/resize`) and streams. Set a **retention** on every group: the default is "never expire", which quietly grows your bill.

```bash
aws logs put-retention-policy --log-group-name /ecs/shop-api --retention-in-days 30
aws logs tail /aws/lambda/resize --since 1h --follow
```

**Logs Insights** queries logs with a pipe-based language:

```
fields @timestamp, status, path, duration_ms
| filter status >= 500
| stats count(*) as errors by path
| sort errors desc
| limit 10
```

Structured JSON logs (from the FastAPI and Spring lessons) make these queries trivial, because each JSON field becomes a queryable field.

## Alarms

An **alarm** watches a metric and changes state (`OK` → `ALARM`) when a threshold is breached for a number of periods, then notifies an SNS topic (email, Slack, PagerDuty) or takes an action (scale, reboot).

```bash
aws cloudwatch put-metric-alarm --alarm-name api-5xx \
  --namespace AWS/ApplicationELB --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value=app/shop-alb/abc123 \
  --statistic Sum --period 60 --evaluation-periods 5 --datapoints-to-alarm 3 \
  --threshold 10 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:eu-west-1:123456789012:oncall
```

Good alarms are **symptom-based**: error rate, latency (p99), queue age, saturation. Users feel those. CPU at 80% is a cause, which matters only if it shows up in symptoms. "3 out of 5 minutes" (`datapoints-to-alarm`) avoids paging on a single blip. Alarm on **DLQ depth > 0** for every queue.

## Tracing

**X-Ray**, or **OpenTelemetry** with the AWS Distro (ADOT), follows one request across the ALB, your service, DynamoDB, an SQS message and the downstream Lambda, showing where the time went. Propagate trace IDs through your logs too, so you can jump from a slow trace to its log lines.

## Audit and security services

- **CloudTrail** records API calls in your account: who did what, when, from where (`DeleteBucket` by `arn:…:assumed-role/admin/alice` from IP X). Enable an **organization trail** to a locked-down S3 bucket in a separate logging account.
- **AWS Config** records resource configurations over time and evaluates rules ("S3 buckets must block public access", "EBS volumes must be encrypted").
- **GuardDuty** detects threats from CloudTrail, VPC Flow Logs and DNS logs: crypto-mining instances, credential exfiltration, access from known-bad IPs.
- **Security Hub** aggregates findings and checks against benchmarks like CIS and AWS Foundational Security Best Practices.

## Infrastructure as code

Clicking resources together in the console is fine for learning and terrible for production: nobody can review it, reproduce it, or know what changed. **Infrastructure as code (IaC)** defines resources in versioned files, reviewed in pull requests and applied by a pipeline.

### CloudFormation

AWS's native IaC: YAML/JSON **templates** deployed as **stacks**. CloudFormation tracks the stack's resources, applies changes in dependency order, and rolls back a failed update.

```yaml title=template.yaml
AWSTemplateFormatVersion: "2010-09-09"
Parameters:
  Env:
    Type: String
    AllowedValues: [dev, prod]
Resources:
  UploadsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub "acme-uploads-${Env}"
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      Tags:
        - Key: Environment
          Value: !Ref Env
Outputs:
  BucketArn:
    Value: !GetAtt UploadsBucket.Arn
```

```bash
aws cloudformation deploy --template-file template.yaml --stack-name uploads-prod \
  --parameter-overrides Env=prod
```

Preview changes with **change sets** before applying. Protect stateful resources with `DeletionPolicy: Retain` (and stack termination protection).

### CDK

The **AWS CDK** writes infrastructure in TypeScript, Python, Java or Go, and **synthesizes** CloudFormation. High-level constructs bundle best practices (one line creates a Fargate service with an ALB, roles, logs and security groups):

```python
bucket = s3.Bucket(self, "Uploads", versioned=True,
                   block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
                   encryption=s3.BucketEncryption.S3_MANAGED,
                   removal_policy=RemovalPolicy.RETAIN)
bucket.grant_read(api_task_role)        # generates a least-privilege policy
```

`cdk diff` shows changes; `cdk deploy` applies them.

### Terraform

**Terraform** (and its open-source fork **OpenTofu**) is multi-cloud: one workflow for AWS, Cloudflare, GitHub, Datadog and more.

```hcl
resource "aws_s3_bucket" "uploads" {
  bucket = "acme-uploads-${var.env}"
  tags   = { Environment = var.env }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration { status = "Enabled" }
}
```

```bash
terraform init      # download providers, configure the backend
terraform plan      # show what would change (review this in the PR)
terraform apply     # make it so
```

Terraform keeps a **state** file mapping code to real resources. Store it remotely (an S3 bucket with versioning, plus locking), never in Git, because it can contain secrets. Changes made by hand in the console cause **drift**: `plan` shows them, and the next `apply` reverts them.

| | CloudFormation | CDK | Terraform |
|---|---|---|---|
| Language | YAML/JSON | TypeScript, Python, Java… | HCL |
| Clouds | AWS | AWS (synthesizes CloudFormation) | many |
| State | managed by AWS | managed by AWS | your backend (S3) |
| New AWS features | usually day one | via CloudFormation | provider releases, usually fast |

## Cost control

AWS bills are easy to run up by accident. Defenses:

- **AWS Budgets** with alerts at 50/80/100% of a monthly amount, plus **Cost Anomaly Detection**. Set these up on day one.
- **Cost allocation tags** (`Team`, `Service`, `Environment`), activated in billing, so Cost Explorer can say who spends what.
- **Right-size**: Compute Optimizer recommends smaller instances, and most are oversized.
- Commit for steady load (**Savings Plans**), use **Spot** for interruptible work, and **Graviton** for ~20% cheaper compute.
- Turn off non-production environments outside working hours.

The usual surprise charges:

| Surprise | Fix |
|---|---|
| **NAT gateway** data processing | VPC gateway endpoints for S3/DynamoDB; interface endpoints for ECR; check what talks to the internet |
| **Data transfer** out to the internet and across AZs/regions | CloudFront in front of origins; keep chatty services in one AZ pair; compress |
| **CloudWatch Logs** ingestion and forever retention | retention policies; log less at INFO; sample debug logs |
| idle **load balancers, Elastic IPs, unattached EBS volumes, old snapshots** | tag, review monthly, automate cleanup |
| forgotten **dev resources** (a big RDS instance, a GPU box) | IaC + budgets + scheduled shutdown |

:::quiz
q: What's the default retention of a new CloudWatch log group?
- 7 days
- 30 days
+ never expire
- 1 year
why: Set retention explicitly, or you pay to store logs forever.
:::

:::quiz
q: Which service answers "who deleted this security group rule yesterday?"
- CloudWatch Metrics
+ CloudTrail
- X-Ray
- GuardDuty
why: CloudTrail records every API call with the caller's identity.
:::

:::quiz
q: What does `terraform plan` do?
+ shows the changes Terraform would make to reach the desired state, without changing anything
- applies changes
- deletes the state file
- downloads providers only
why: Review the plan in the PR; apply it in the pipeline.
:::

:::quiz
q: Why shouldn't Terraform state be committed to Git?
+ it can contain secrets, and concurrent edits corrupt it; use a remote backend with locking
- Git can't store JSON
- Terraform deletes it after apply
- it's always empty
why: Remote state (e.g. S3 with locking) is shared and safely locked.
:::

:::quiz
q: Private ECS tasks pull large images through a NAT gateway and the NAT bill is huge. The cheapest structural fix?
- a bigger NAT gateway
+ VPC endpoints for ECR and S3 so pulls bypass the NAT gateway
- public IPs on the tasks
- Spot instances
why: Gateway endpoints for S3 are free; interface endpoints cost far less than NAT data processing at volume.
:::

:::exercise
id: ao-retention
level: 1
title: Stop paying for old logs
mode: code
lang: bash
file: logs.sh
---
Set the retention of the log group `/aws/lambda/resize` to **14** days.
---starter
#!/bin/sh
---rule
aws\s+logs\s+put-retention-policy
`aws logs put-retention-policy`
---rule
--log-group-name[ =]/aws/lambda/resize
`--log-group-name /aws/lambda/resize`
---rule
--retention-in-days[ =]14
`--retention-in-days 14`
---solution
#!/bin/sh
aws logs put-retention-policy --log-group-name /aws/lambda/resize --retention-in-days 14
:::

:::exercise
id: ao-alarm
level: 3
title: Alarm on the DLQ
mode: code
lang: bash
file: alarm.sh
---
Create an alarm `orders-dlq-not-empty` on the `AWS/SQS` metric `ApproximateNumberOfMessagesVisible` for `QueueName=orders-dlq`, statistic `Maximum`, period `60`, `1` evaluation period, threshold `0` with comparison `GreaterThanThreshold`, notifying `arn:aws:sns:eu-west-1:123456789012:oncall`.
---starter
#!/bin/sh
---rule
aws\s+cloudwatch\s+put-metric-alarm
`aws cloudwatch put-metric-alarm`
---rule
--alarm-name[ =]orders-dlq-not-empty
The alarm name
---rule
--namespace[ =]AWS/SQS
`--namespace AWS/SQS`
---rule
--metric-name[ =]ApproximateNumberOfMessagesVisible
The metric
---rule
--dimensions[ =]Name=QueueName,Value=orders-dlq
`--dimensions Name=QueueName,Value=orders-dlq`
---rule
--statistic[ =]Maximum
`--statistic Maximum`
---rule
--period[ =]60
`--period 60`
---rule
--evaluation-periods[ =]1
`--evaluation-periods 1`
---rule
--threshold[ =]0\b
`--threshold 0`
---rule
--comparison-operator[ =]GreaterThanThreshold
`GreaterThanThreshold`
---rule
--alarm-actions[ =]arn:aws:sns:eu-west-1:123456789012:oncall
Notify on-call
---solution
#!/bin/sh
aws cloudwatch put-metric-alarm --alarm-name orders-dlq-not-empty \
  --namespace AWS/SQS --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=orders-dlq \
  --statistic Maximum --period 60 --evaluation-periods 1 \
  --threshold 0 --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:eu-west-1:123456789012:oncall
:::

:::exercise
id: ao-cfn
level: 3
title: A CloudFormation bucket
mode: code
lang: yaml
file: template.yaml
---
Write a CloudFormation template with a resource `LogsBucket` of type `AWS::S3::Bucket` that has versioning **enabled** and all four Block Public Access settings set to `true`, and an output `BucketName` whose value is `!Ref LogsBucket`.
---starter
AWSTemplateFormatVersion: "2010-09-09"
---rule
^Resources:\s*\n\s+LogsBucket:\s*\n\s+Type:\s*["']?AWS::S3::Bucket["']?
`LogsBucket` of type `AWS::S3::Bucket`
---rule
VersioningConfiguration:\s*\n\s+Status:\s*["']?Enabled["']?
Versioning enabled
---rule
BlockPublicAcls:\s*true
`BlockPublicAcls: true`
---rule
BlockPublicPolicy:\s*true
`BlockPublicPolicy: true`
---rule
IgnorePublicAcls:\s*true
`IgnorePublicAcls: true`
---rule
RestrictPublicBuckets:\s*true
`RestrictPublicBuckets: true`
---rule
^Outputs:\s*\n\s+BucketName:\s*\n\s+Value:\s*!Ref\s+LogsBucket
Output `BucketName: !Ref LogsBucket`
---solution
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  LogsBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
Outputs:
  BucketName:
    Value: !Ref LogsBucket
:::

:::exercise
id: ao-insights
level: 3
title: A Logs Insights query
mode: code
lang: bash
file: query.txt
---
Write a Logs Insights query that keeps only log events whose `status` field is **>= 500**, counts them **by `path`** as `errors`, and sorts by `errors` descending.
---starter
fields @timestamp, status, path
---rule
\|\s*filter\s+status\s*>=\s*500
`| filter status >= 500`
---rule
\|\s*stats\s+count\(\s*\*?\s*\)\s+as\s+errors\s+by\s+path
`| stats count(*) as errors by path`
---rule
\|\s*sort\s+errors\s+desc
`| sort errors desc`
---rule
filter[\s\S]*stats[\s\S]*sort
filter, then stats, then sort
---solution
fields @timestamp, status, path
| filter status >= 500
| stats count(*) as errors by path
| sort errors desc
:::

:::exercise
id: ao-tf-order
level: 2
title: Terraform workflow
mode: answer
---
In a fresh checkout of a Terraform project, which command must run **first**, before `plan` or `apply`?
---answer
terraform init
---solution
terraform init
:::

:::exercise
id: ao-budget
level: 2
title: First thing in a new account
mode: answer
---
Which AWS service sends you an alert when your forecast monthly spend exceeds an amount you set? (Two words.)
---answer
AWS Budgets
---answer
budgets
---solution
AWS Budgets
:::
