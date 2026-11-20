---
id: aws-containers
title: Containers on AWS: ECR & ECS
summary: Pushing images to ECR with lifecycle policies and scanning, ECS concepts (clusters, task definitions, services), Fargate vs EC2 capacity, writing a task definition with secrets and logs, services behind an ALB with health checks, rolling deployments and the circuit breaker, autoscaling, ECS Exec, and when to choose App Runner or EKS.
minutes: 45
---
> [!project] Taskboard, step 7: the API on Fargate
> This is the step that replaces the single EC2 box: Taskboard's image in ECR, a task definition with its secrets and logs, and an ECS service across two AZs behind the ALB, deployed by the pipeline from the CI/CD track.

## Choosing where containers run

| Service | You manage | Good for |
|---|---|---|
| **App Runner** | almost nothing: give it an image, get an HTTPS URL | simple web apps and APIs |
| **ECS on Fargate** | task definitions and services; no servers | most containerized services on AWS |
| **ECS on EC2** | plus the instances (AMIs, scaling, patching) | GPUs, special instance types, max cost control |
| **EKS** | Kubernetes (control plane managed) | teams standardized on Kubernetes, portability, its ecosystem |
| **Lambda (container images)** | functions | event-driven, short tasks (next lesson) |

This lesson focuses on **ECR + ECS Fargate**, the most common AWS-native setup.

## ECR: the image registry

```bash
aws ecr create-repository --repository-name shop-api \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability IMMUTABLE

aws ecr get-login-password --region eu-west-1 \
  | docker login --username AWS --password-stdin 123456789012.dkr.ecr.eu-west-1.amazonaws.com

docker tag shop-api:1.4.2 123456789012.dkr.ecr.eu-west-1.amazonaws.com/shop-api:1.4.2
docker push 123456789012.dkr.ecr.eu-west-1.amazonaws.com/shop-api:1.4.2
```

- **Immutable tags** stop anyone from overwriting `1.4.2` with different content.
- **Scan on push** (or Inspector enhanced scanning) reports CVEs.
- **Lifecycle policies** delete old images automatically, e.g. keep the last 30 tagged images and expire untagged ones after 7 days. Otherwise storage costs grow forever.

A lifecycle policy is JSON: a list of `rules`, applied in `rulePriority` order (lowest first). Each rule **selects** images and says what to do with them:

```json title=ecr-lifecycle.json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "keep the last 30 tagged images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["v"],
        "countType": "imageCountMoreThan",
        "countNumber": 30
      },
      "action": { "type": "expire" }
    }
  ]
}
```

| Selection key | Means |
|---|---|
| `tagStatus` | `tagged`, `untagged` or `any` |
| `countType` | `imageCountMoreThan` (keep the newest N) or `sinceImagePushed` (older than a time) |
| `countUnit` | with `sinceImagePushed`: `days` |
| `countNumber` | the N images, or the number of days |

```bash
aws ecr put-lifecycle-policy --repository-name shop-api --lifecycle-policy-text file://ecr-lifecycle.json
```

## ECS concepts

| Concept | Is |
|---|---|
| **Cluster** | a logical grouping of services and tasks |
| **Task definition** | a versioned JSON blueprint: images, CPU/memory, ports, env, secrets, logging, roles. Like a Compose service. |
| **Task** | a running instance of a task definition (one or more containers that share networking) |
| **Service** | keeps N tasks running, replaces failed ones, registers them with a load balancer, and handles rolling deployments |
| **Capacity provider** | where tasks run: `FARGATE`, `FARGATE_SPOT`, or an EC2 Auto Scaling group |

## A task definition

```json title=task-definition.json
{
  "family": "shop-api",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "arn:aws:iam::123456789012:role/shop-api-execution",
  "taskRoleArn": "arn:aws:iam::123456789012:role/shop-api-task",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "123456789012.dkr.ecr.eu-west-1.amazonaws.com/shop-api:1.4.2",
      "essential": true,
      "portMappings": [{ "containerPort": 8000, "protocol": "tcp" }],
      "environment": [
        { "name": "LOG_LEVEL", "value": "info" }
      ],
      "secrets": [
        { "name": "DATABASE_PASSWORD", "valueFrom": "arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/shop/db-AbCdEf:password::" }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -fs http://localhost:8000/health || exit 1"],
        "interval": 15, "timeout": 5, "retries": 3, "startPeriod": 20
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/shop-api",
          "awslogs-region": "eu-west-1",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
```

Things to notice:

- **Fargate** requires `networkMode: awsvpc` (each task gets its own network interface and private IP, with its own security group) and task-level `cpu`/`memory` from fixed combinations (e.g. 512 CPU units = 0.5 vCPU with 1–4 GB).
- **`secrets`** injects values from Secrets Manager or SSM Parameter Store as environment variables at startup. The **execution role** needs permission to read them; the values never appear in the task definition.
- **`runtimePlatform`** `ARM64` runs on Graviton (cheaper): the image must have an arm64 variant.
- **`awslogs`** sends stdout/stderr to CloudWatch Logs. Log to stdout; don't write log files in containers.

```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

Each registration creates a new **revision** (`shop-api:17`); services point at a specific revision.

## A service behind a load balancer

```bash
aws ecs create-service --cluster shop --service-name api \
  --task-definition shop-api:17 --desired-count 2 \
  --capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0priv-a,subnet-0priv-b],securityGroups=[sg-0api],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/api/abc123,containerName=api,containerPort=8000" \
  --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},minimumHealthyPercent=100,maximumPercent=200"
```

- Tasks run in **private subnets** without public IPs; the ALB in public subnets forwards to them. The task security group allows the app port only from the ALB's security group.
- The **target group** uses target type `ip` (required with `awsvpc`) and a health check path like `/health`.
- Pulling from ECR from private subnets needs a NAT gateway or VPC endpoints for ECR (api + dkr), S3 and CloudWatch Logs.

## Deployments

Updating the service with a new task definition revision starts a **rolling deployment**:

- `minimumHealthyPercent=100`, `maximumPercent=200`: start new tasks first, shift traffic, then stop old ones: no capacity loss.
- New tasks must pass container **and** target-group health checks before old ones drain.
- The **deployment circuit breaker** with `rollback=true` stops a deployment whose tasks keep failing and returns to the last working revision automatically.
- For blue/green with traffic shifting (canary, linear), use ECS's built-in blue/green deployments or CodeDeploy.

```bash
aws ecs update-service --cluster shop --service api --task-definition shop-api:18
aws ecs wait services-stable --cluster shop --services api
```

## Scaling

```bash
aws application-autoscaling register-scalable-target --service-namespace ecs \
  --resource-id service/shop/api --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 --max-capacity 10

aws application-autoscaling put-scaling-policy --service-namespace ecs \
  --resource-id service/shop/api --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu60 --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
  '{"TargetValue":60,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"}}'
```

Track CPU, memory, or **ALB requests per target**. Keep at least 2 tasks across 2 AZs for availability. `FARGATE_SPOT` capacity is up to ~70% cheaper for interruptible workers.

## Debugging

- **Stopped tasks** show a reason: `CannotPullContainerError` (ECR permissions, no route to ECR), `ResourceInitializationError` (secrets the execution role can't read), `Essential container exited` (your app crashed: read the logs), health check failures.
- **Logs**: `aws logs tail /ecs/shop-api --follow`.
- **ECS Exec** opens a shell in a running container (via SSM, no SSH): `aws ecs execute-command --cluster shop --task <id> --container api --interactive --command "/bin/sh"` (enable it on the service and give the task role SSM permissions).

## Worked example: mapping Compose to ECS

You've already described Taskboard in `compose.yaml`. ECS asks for the same information in different places:

| compose.yaml | ECS |
|---|---|
| `image:` | `containerDefinitions[].image` (from ECR) |
| `ports: ["8000:8000"]` | `portMappings` + target group on the ALB |
| `environment:` | `environment` (non-secret) |
| secrets / `.env` | `secrets` with `valueFrom` Secrets Manager ARNs |
| `deploy.resources.limits` | task `cpu` / `memory` |
| `healthcheck:` | container `healthCheck` + target group health check |
| `restart: unless-stopped` | the **service** keeps `desiredCount` tasks running |
| `db` service | RDS (not a container in production) |
| `docker compose up` | `aws ecs update-service` from the pipeline |

The concepts transfer directly; production adds what Compose can't do on one host: spreading across AZs, load balancing, rolling deployments with automatic rollback, and autoscaling.

## The deploy path, end to end

1. CI builds `taskboard:sha-3f2c1ab` and pushes it to ECR.
2. The pipeline renders the task definition with that image and registers revision 42.
3. `update-service --task-definition taskboard-api:42` starts a rolling deployment.
4. New tasks start in the private subnets, pull the image (via VPC endpoints or NAT), read secrets, pass the container and ALB health checks.
5. The ALB shifts traffic to them; old tasks drain and stop.
6. If new tasks keep failing, the **circuit breaker** rolls back to revision 41.

> [!plain] In plain English
> A task definition describes **one copy** of Taskboard; a service keeps **N copies** running, replaces broken ones, and swaps in new versions safely.

:::quiz
q: Which network mode does Fargate require?
- bridge
- host
+ awsvpc
- none
why: Each Fargate task gets its own ENI and private IP in your subnets.
:::

:::quiz
q: A task's `secrets` entry references a Secrets Manager ARN, and the task fails with ResourceInitializationError. Which role needs `secretsmanager:GetSecretValue`?
- the task role
+ the task execution role
- the ALB's role
- the cluster's role
why: ECS (using the execution role) fetches secrets before your container starts.
:::

:::quiz
q: What does the deployment circuit breaker with rollback do?
+ stops a deployment whose new tasks keep failing and rolls back to the last stable revision
- limits CPU usage
- blocks traffic during deployments
- prevents scaling
why: It turns a bad release into an automatic rollback instead of an endless failing loop.
:::

:::quiz
q: Why set ECR tags to IMMUTABLE?
+ so a tag like 1.4.2 can never be overwritten with different content
- to make images smaller
- to enable scanning
- to allow cross-region replication
why: Deployments that reference a tag then always get the same image.
:::

:::exercise
id: ac-ecr-push
level: 2
title: Push to ECR
mode: code
lang: bash
file: push.sh
---
Log Docker in to the registry `123456789012.dkr.ecr.eu-west-1.amazonaws.com` using `aws ecr get-login-password` piped into `docker login --username AWS --password-stdin`, then push `123456789012.dkr.ecr.eu-west-1.amazonaws.com/shop-api:$TAG`.
---starter
#!/bin/sh
set -e
REGISTRY=123456789012.dkr.ecr.eu-west-1.amazonaws.com
---rule
aws\s+ecr\s+get-login-password(\s+--region[ =]eu-west-1)?\s*\|\s*docker\s+login\s+--username[ =]AWS\s+--password-stdin\s+("?\$\{?REGISTRY\}?"?|123456789012\.dkr\.ecr\.eu-west-1\.amazonaws\.com)
`aws ecr get-login-password | docker login --username AWS --password-stdin $REGISTRY`
---rule
docker\s+push\s+("?\$\{?REGISTRY\}?|123456789012\.dkr\.ecr\.eu-west-1\.amazonaws\.com)/shop-api:\$\{?TAG\}?
`docker push $REGISTRY/shop-api:$TAG`
---rule
get-login-password[\s\S]*docker\s+push
Log in before pushing
---solution
#!/bin/sh
set -e
REGISTRY=123456789012.dkr.ecr.eu-west-1.amazonaws.com
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin $REGISTRY
docker push $REGISTRY/shop-api:$TAG
:::

:::exercise
id: ac-taskdef
level: 3
title: Complete the task definition
mode: code
lang: json
file: task-definition.json
---
Complete this Fargate task definition: `networkMode` `awsvpc`, compatibility `FARGATE`, task `cpu` `"256"` and `memory` `"512"`; container `web` gets a port mapping for **8080**, and the secret `DB_PASSWORD` from `arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/db-AbCdEf`, and logs with the `awslogs` driver to group `/ecs/web`.
---starter
{
  "family": "web",
  "executionRoleArn": "arn:aws:iam::123456789012:role/web-execution",
  "taskRoleArn": "arn:aws:iam::123456789012:role/web-task",
  "containerDefinitions": [
    {
      "name": "web",
      "image": "123456789012.dkr.ecr.eu-west-1.amazonaws.com/web:2.0.1",
      "essential": true
    }
  ]
}
---rule
"networkMode"\s*:\s*"awsvpc"
`"networkMode": "awsvpc"`
---rule
"requiresCompatibilities"\s*:\s*\[\s*"FARGATE"\s*\]
`"requiresCompatibilities": ["FARGATE"]`
---rule
"cpu"\s*:\s*"256"
`"cpu": "256"`
---rule
"memory"\s*:\s*"512"
`"memory": "512"`
---rule
"portMappings"\s*:\s*\[\s*\{\s*"containerPort"\s*:\s*8080
Port mapping 8080
---rule
"secrets"\s*:\s*\[\s*\{\s*"name"\s*:\s*"DB_PASSWORD"\s*,\s*"valueFrom"\s*:\s*"arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/db-AbCdEf"
The `DB_PASSWORD` secret
---rule
"logDriver"\s*:\s*"awslogs"
`awslogs` driver
---rule
"awslogs-group"\s*:\s*"/ecs/web"
Log group `/ecs/web`
---solution
{
  "family": "web",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::123456789012:role/web-execution",
  "taskRoleArn": "arn:aws:iam::123456789012:role/web-task",
  "containerDefinitions": [
    {
      "name": "web",
      "image": "123456789012.dkr.ecr.eu-west-1.amazonaws.com/web:2.0.1",
      "essential": true,
      "portMappings": [{ "containerPort": 8080, "protocol": "tcp" }],
      "secrets": [
        { "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:eu-west-1:123456789012:secret:prod/db-AbCdEf" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/web",
          "awslogs-region": "eu-west-1",
          "awslogs-stream-prefix": "web"
        }
      }
    }
  ]
}
:::

:::exercise
id: ac-deploy
level: 2
title: Roll out a new revision
mode: code
lang: bash
file: deploy.sh
---
Update service `api` in cluster `shop` to task definition `shop-api:18`, then wait until the service is stable.
---starter
#!/bin/sh
set -e
---rule
aws\s+ecs\s+update-service\s+(?=[^\n]*--cluster[ =]shop)(?=[^\n]*--service[ =]api)(?=[^\n]*--task-definition[ =]shop-api:18)
`aws ecs update-service --cluster shop --service api --task-definition shop-api:18`
---rule
aws\s+ecs\s+wait\s+services-stable\s+(?=[^\n]*--cluster[ =]shop)(?=[^\n]*--services[ =]api)
`aws ecs wait services-stable --cluster shop --services api`
---solution
#!/bin/sh
set -e
aws ecs update-service --cluster shop --service api --task-definition shop-api:18
aws ecs wait services-stable --cluster shop --services api
:::

:::exercise
id: ac-lifecycle
level: 3
title: An ECR lifecycle policy
mode: code
lang: json
file: ecr-lifecycle.json
---
Write an ECR lifecycle policy with one rule (`rulePriority` 1, description `expire untagged`) that **expires untagged images** older than **7 days** (`countType` `sinceImagePushed`, `countUnit` `days`).
---starter
{
  "rules": []
}
---rule
"rulePriority"\s*:\s*1
`"rulePriority": 1`
---rule
"tagStatus"\s*:\s*"untagged"
`"tagStatus": "untagged"`
---rule
"countType"\s*:\s*"sinceImagePushed"
`"countType": "sinceImagePushed"`
---rule
"countUnit"\s*:\s*"days"
`"countUnit": "days"`
---rule
"countNumber"\s*:\s*7\b
`"countNumber": 7`
---rule
"action"\s*:\s*\{\s*"type"\s*:\s*"expire"\s*\}
`"action": {"type": "expire"}`
---solution
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "expire untagged",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": { "type": "expire" }
    }
  ]
}
:::

:::exercise
id: ac-logs
level: 1
title: Follow the logs
mode: code
lang: bash
file: logs.sh
---
Stream (follow) the CloudWatch log group `/ecs/shop-api` from the CLI.
---starter
#!/bin/sh
---rule
aws\s+logs\s+tail\s+/ecs/shop-api\s+--follow|aws\s+logs\s+tail\s+--follow\s+/ecs/shop-api
`aws logs tail /ecs/shop-api --follow`
---solution
#!/bin/sh
aws logs tail /ecs/shop-api --follow
:::

:::exercise
id: ac-stopped
level: 3
title: Read the stop reason
mode: answer
---
New tasks stop immediately with `CannotPullContainerError: ... dial tcp ...:443: i/o timeout`. The tasks run in private subnets with no NAT gateway. Which kind of AWS resource would let them reach ECR without a NAT gateway? (Two words.)
---answer
VPC endpoints
---answer
vpc endpoint
---answer
interface endpoints
---answer
interface endpoint
---solution
VPC endpoints
---explain
Interface endpoints for `ecr.api` and `ecr.dkr`, plus a gateway endpoint for S3 (where layers are stored), and one for CloudWatch Logs.
:::

:::exercise
id: ac-pick
level: 2
title: Pick the service
mode: answer
---
A small team wants to run one containerized web API with HTTPS and autoscaling, and manage nothing else: no clusters, task definitions or load balancers. Which AWS service?
---answer
App Runner
---answer
AWS App Runner
---solution
App Runner
:::

:::exercise
id: proj-aws-07-taskdef
level: 4
title: "Project 7: Taskboard's task definition"
mode: code
lang: json
file: taskboard-task.json
path: infra/aws/taskboard-task.json
---
Complete the task definition: Fargate (`requiresCompatibilities` `["FARGATE"]`, `networkMode` `awsvpc`), task `cpu` `"512"` and `memory` `"1024"`, `runtimePlatform` with `cpuArchitecture` `ARM64`; container `api` with port **8000**, environment `LOG_LEVEL=info`, secrets `DATABASE_PASSWORD` from `arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/db` and `SECRET_KEY` from `arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/app`, and `awslogs` logging to `/ecs/taskboard-api`.
---starter
{
  "family": "taskboard-api",
  "executionRoleArn": "arn:aws:iam::222222222222:role/taskboard-api-execution",
  "taskRoleArn": "arn:aws:iam::222222222222:role/taskboard-api-task",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "222222222222.dkr.ecr.eu-west-1.amazonaws.com/taskboard:sha-3f2c1ab",
      "essential": true
    }
  ]
}
---rule
"requiresCompatibilities"\s*:\s*\[\s*"FARGATE"\s*\]
Fargate
---rule
"networkMode"\s*:\s*"awsvpc"
`awsvpc`
---rule
"cpu"\s*:\s*"512"
CPU 512
---rule
"memory"\s*:\s*"1024"
Memory 1024
---rule
"cpuArchitecture"\s*:\s*"ARM64"
Graviton
---rule
"containerPort"\s*:\s*8000
Port 8000
---rule
\{\s*"name"\s*:\s*"LOG_LEVEL"\s*,\s*"value"\s*:\s*"info"\s*\}
`LOG_LEVEL=info`
---rule
\{\s*"name"\s*:\s*"DATABASE_PASSWORD"\s*,\s*"valueFrom"\s*:\s*"arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/db"\s*\}
`DATABASE_PASSWORD` secret
---rule
\{\s*"name"\s*:\s*"SECRET_KEY"\s*,\s*"valueFrom"\s*:\s*"arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/app"\s*\}
`SECRET_KEY` secret
---rule
"logDriver"\s*:\s*"awslogs"[\s\S]*"awslogs-group"\s*:\s*"/ecs/taskboard-api"
CloudWatch logs
---solution
{
  "family": "taskboard-api",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "arn:aws:iam::222222222222:role/taskboard-api-execution",
  "taskRoleArn": "arn:aws:iam::222222222222:role/taskboard-api-task",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "222222222222.dkr.ecr.eu-west-1.amazonaws.com/taskboard:sha-3f2c1ab",
      "essential": true,
      "portMappings": [{ "containerPort": 8000, "protocol": "tcp" }],
      "environment": [{ "name": "LOG_LEVEL", "value": "info" }],
      "secrets": [
        { "name": "DATABASE_PASSWORD", "valueFrom": "arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/db" },
        { "name": "SECRET_KEY", "valueFrom": "arn:aws:secretsmanager:eu-west-1:222222222222:secret:taskboard/prod/app" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/taskboard-api",
          "awslogs-region": "eu-west-1",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
:::

:::exercise
id: proj-aws-07-service
level: 4
title: "Project 7b: the service"
mode: code
lang: bash
file: create-service.sh
path: infra/aws/create-service.sh
---
Create the service `taskboard-api` in cluster `taskboard` from `taskboard-api:1` with **2** tasks on `FARGATE`, in subnets `subnet-0priv-a` and `subnet-0priv-b` with security group `sg-0api` and **no public IP**, attached to target group `arn:aws:elasticloadbalancing:eu-west-1:222222222222:targetgroup/taskboard/abc123` (container `api`, port 8000), with the deployment circuit breaker **enabled with rollback**.
---starter
#!/bin/sh
---rule
aws\s+ecs\s+create-service
`aws ecs create-service`
---rule
--cluster[ =]taskboard\b
Cluster
---rule
--service-name[ =]taskboard-api
Service name
---rule
--task-definition[ =]taskboard-api:1
Task definition
---rule
--desired-count[ =]2
Two tasks
---rule
capacityProvider=FARGATE|--launch-type[ =]FARGATE
Fargate
---rule
subnets=\[subnet-0priv-a,subnet-0priv-b\]
Private subnets
---rule
securityGroups=\[sg-0api\]
Security group
---rule
assignPublicIp=DISABLED
No public IP
---rule
targetGroupArn=arn:aws:elasticloadbalancing:eu-west-1:222222222222:targetgroup/taskboard/abc123,containerName=api,containerPort=8000
Load balancer attachment
---rule
deploymentCircuitBreaker=\{enable=true,rollback=true\}
Circuit breaker with rollback
---solution
#!/bin/sh
aws ecs create-service --cluster taskboard --service-name taskboard-api \
  --task-definition taskboard-api:1 --desired-count 2 \
  --capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0priv-a,subnet-0priv-b],securityGroups=[sg-0api],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:eu-west-1:222222222222:targetgroup/taskboard/abc123,containerName=api,containerPort=8000" \
  --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}"
:::
