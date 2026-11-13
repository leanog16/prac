## Basics

| Concept | Remember |
|---|---|
| Region / AZ | deploy across 2–3 AZs for availability |
| Shared responsibility | AWS: the cloud; you: what's in it (IAM, data, OS on EC2, SGs) |
| Root user | MFA, no access keys, don't use it |
| Credentials order | CLI flags → env vars → `~/.aws` files/SSO → ECS task role → EC2 instance role |
| ARN | `arn:aws:service:region:account:resource` (S3 and IAM have empty fields) |

```bash
aws configure sso && aws sso login --profile dev
aws sts get-caller-identity
aws ec2 describe-instances --query 'Reservations[].Instances[].InstanceId' --output text
```

## IAM

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::bucket/prefix/*",
    "Condition": { "Bool": { "aws:SecureTransport": "true" } }
  }]
}
```

- Default deny → explicit **Deny always wins** → any Allow (within SCPs and boundaries).
- Roles for workloads and CI (OIDC); Identity Center for people; no long-lived keys.
- Role = permissions policy (what) + trust policy (who can assume).
- ECS: **task role** (your code) vs **execution role** (pull image, read secrets, logs).
- `s3:ListBucket` → bucket ARN; object actions → `bucket/*`. SSE-KMS also needs `kms:Decrypt`.

## Networking

| Piece | Remember |
|---|---|
| public subnet | route `0.0.0.0/0` → internet gateway |
| private subnet | route `0.0.0.0/0` → NAT gateway (outbound only, per-GB cost) |
| isolated subnet | no default route: databases |
| security group | stateful, allow-only, can reference other SGs |
| NACL | stateless, allow + deny, numbered rules, per subnet |
| gateway endpoint | S3, DynamoDB: free, keeps traffic off NAT |
| interface endpoint | ECR, Secrets Manager, SQS, Logs… |
| /24 | 256 addresses, 251 usable |
| timeout vs refused | timeout = network/firewall; refused = nothing listening |

## Compute

| Option | When |
|---|---|
| EC2 + ASG + ALB | full control, long-running |
| ECS Fargate | containers without servers (the default) |
| App Runner | simplest container web app |
| EKS | Kubernetes |
| Lambda | events, bursty, short (≤ 15 min) |

EC2: Session Manager instead of SSH · IMDSv2 required · user data for bootstrap · `m7g` = Graviton/ARM · Spot for interruptible work, Savings Plans for baseline.

## Storage and data

```bash
aws s3 sync ./dist s3://bucket --delete
aws s3 presign s3://bucket/key --expires-in 900
aws s3api put-bucket-versioning --bucket b --versioning-configuration Status=Enabled
```

S3: Block Public Access on · versioning + lifecycle (expire noncurrent versions) · CloudFront + OAC for sites · presigned URLs for uploads.

| Database | Use |
|---|---|
| RDS / Aurora | relational; Multi-AZ = availability, read replica = read scaling; Secrets Manager for credentials; RDS Proxy for many connections |
| DynamoDB | design keys from access patterns; Query not Scan; GSIs; conditional writes; TTL; on-demand billing |
| ElastiCache | cache, sessions, counters |

## Containers

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin $REGISTRY
aws ecs register-task-definition --cli-input-json file://taskdef.json
aws ecs update-service --cluster c --service s --task-definition fam:REV
aws ecs wait services-stable --cluster c --services s
aws logs tail /ecs/app --follow
```

Fargate: `awsvpc`, task cpu/memory, `secrets` from Secrets Manager, `awslogs` driver, private subnets behind an ALB, circuit breaker with rollback, target-tracking autoscaling.

## Serverless and messaging

| Service | Remember |
|---|---|
| Lambda | init outside the handler; memory = CPU; reserved concurrency to protect downstreams |
| API Gateway (HTTP API) | routes → functions, JWT authorizers, CORS |
| SQS | at-least-once → idempotent consumers; visibility timeout > processing time (6× for Lambda); DLQ + alarm; `batchItemFailures` |
| SNS | fan-out to many subscribers (SNS → SQS per consumer) |
| EventBridge | content-based routing; Scheduler for cron |
| Step Functions | multi-step workflows with retries and compensation |

## Operations

```bash
aws logs put-retention-policy --log-group-name /ecs/app --retention-in-days 30
aws cloudwatch put-metric-alarm --alarm-name … --metric-name … --threshold … --alarm-actions arn:aws:sns:…
```

CloudWatch metrics, logs (set retention!), Logs Insights, alarms on symptoms · CloudTrail = who did what · Config, GuardDuty, Security Hub.

## IaC and cost

| Tool | Command flow |
|---|---|
| CloudFormation | `aws cloudformation deploy --template-file t.yaml --stack-name s` (change sets to preview) |
| CDK | `cdk diff` → `cdk deploy` |
| Terraform | `terraform init` → `plan` → `apply`; remote state in S3 with locking |

Cost: Budgets + anomaly detection on day one · cost allocation tags · right-size · Graviton, Spot, Savings Plans · watch NAT data, data transfer, log ingestion, idle resources.
