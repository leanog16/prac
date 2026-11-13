---
id: aws-serverless
title: Lambda & event-driven services
summary: Lambda handlers, events and context, configuration (memory, timeout, environment), cold starts and concurrency, API Gateway HTTP APIs, SQS queues with visibility timeouts, dead-letter queues, batch failures and idempotency, SNS fan-out, EventBridge rules and schedules, and Step Functions.
minutes: 45
---
## Lambda in one minute

**AWS Lambda** runs your function in response to events, with no servers to manage. You pay per request and per millisecond of execution × memory, and nothing when idle.

```python title=handler.py
import json
import os

import boto3

TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])    # created once per execution environment


def handler(event, context):
    order_id = event["pathParameters"]["id"]
    item = TABLE.get_item(Key={"order_id": order_id}).get("Item")
    if item is None:
        return {"statusCode": 404, "body": json.dumps({"detail": "not found"})}
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(item, default=str),
    }
```

- The **handler** receives the **event** (a dict whose shape depends on the trigger) and a **context** (request ID, remaining time).
- Code **outside** the handler runs once per execution environment and is reused across invocations: create SDK clients and connection pools there.
- Configuration: **memory** 128 MB–10 GB (CPU scales with memory), **timeout** up to 15 minutes, environment variables, an **execution role**, optional VPC access, architecture `arm64` (cheaper) or `x86_64`.
- Package as a zip (with **layers** for shared dependencies) or a **container image** up to 10 GB.

## Cold starts and concurrency

The first invocation on a new execution environment is a **cold start**: download code, start the runtime, run your init code. That adds roughly 100 ms–1 s+ (more for big packages, the JVM, or VPC-attached functions in the past). Later invocations on that environment are **warm**.

- Keep packages small and initialization lazy; avoid heavy frameworks at import time.
- **Provisioned concurrency** keeps N environments initialized (you pay for them). **SnapStart** (Java, Python, .NET) snapshots an initialized environment to cut cold starts.
- **Concurrency** = requests being handled at the same moment. Each environment handles one request at a time, so 100 concurrent requests means 100 environments. Accounts have a regional limit (1,000 by default). **Reserved concurrency** caps a function, which protects downstream databases from being overwhelmed.

## Triggers: synchronous vs asynchronous

| Invocation | Examples | Errors |
|---|---|---|
| **synchronous** | API Gateway, ALB, direct `Invoke` | returned to the caller, who decides whether to retry |
| **asynchronous** | S3 events, SNS, EventBridge | Lambda retries twice, then sends the event to an on-failure destination or DLQ |
| **poll-based** (event source mapping) | SQS, Kinesis, DynamoDB Streams | Lambda polls and retries batches according to the source's rules |

## API Gateway: HTTP in front of Lambda

**HTTP APIs** (the newer, cheaper flavor of API Gateway) map routes to functions:

```
GET  /orders/{id}  → get-order function
POST /orders       → create-order function
```

API Gateway handles TLS, custom domains, CORS, throttling, and JWT authorizers (Cognito or any OIDC issuer). Your function returns `{statusCode, headers, body}`. For an existing FastAPI app, **Mangum** adapts ASGI to Lambda events (`handler = Mangum(app)`), although for steady, heavy traffic a container on ECS is often cheaper.

## SQS: decoupling with queues

An **SQS queue** buffers work between producers and consumers. The producer returns immediately; consumers process at their own pace, and a traffic spike becomes a longer queue instead of an outage.

```python
sqs = boto3.client("sqs")
sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps({"order_id": "o-123"}))
```

How consumption works:

1. A consumer **receives** a message; it becomes invisible for the **visibility timeout**.
2. If the consumer **deletes** it before the timeout, it's done.
3. If not (crash, timeout, error), it becomes visible again and is **retried**.

So:

- Set the visibility timeout **longer** than your processing time (for Lambda: at least 6× the function timeout), or messages are processed twice while still in progress.
- Configure a **dead-letter queue (DLQ)** with `maxReceiveCount` (e.g. 5): a "poison" message that always fails moves aside instead of retrying forever. Alarm on DLQ depth.
- **Standard** queues deliver **at least once**, in roughly the order sent. **FIFO** queues give exactly-once processing and strict order per message group, with lower throughput.
- Because delivery is at-least-once, consumers must be **idempotent**: processing the same message twice must not charge a card twice. Record processed message or business IDs (a DynamoDB conditional put works well).

### Lambda + SQS with partial batch failures

```python
def handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            process(json.loads(record["body"]))
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
```

With `ReportBatchItemFailures` enabled on the event source mapping, only the failed messages return to the queue. Without it, one bad message makes the **whole batch** retry, including the messages that succeeded.

## SNS: fan-out

An **SNS topic** pushes each published message to every subscriber: SQS queues, Lambda functions, HTTP endpoints, email, SMS. The classic pattern is **SNS → several SQS queues**: an `OrderPlaced` event goes to the email queue, the analytics queue and the warehouse queue, and each consumer scales and fails independently. Subscription **filter policies** let each queue receive only the messages it cares about.

## EventBridge: routing events by content

**EventBridge** is an event bus. Producers put structured events; **rules** match them by pattern and route them to targets:

```json title=rule pattern
{
  "source": ["shop.orders"],
  "detail-type": ["OrderPlaced"],
  "detail": { "total": [{ "numeric": [">=", 1000] }] }
}
```

It also receives events from AWS services (an EC2 instance stopped, an ECS task failed, a CodePipeline stage finished) and from SaaS partners. **EventBridge Scheduler** runs targets on cron or rate schedules (`cron(0 3 * * ? *)`, `rate(5 minutes)`) or once at a given time: the serverless replacement for a cron server.

## Step Functions: workflows

When a process has several steps, retries, branches, waits or human approvals (place order → charge card → reserve stock → ship, with compensation if a step fails), **Step Functions** orchestrates it as a state machine, with built-in retries, error handling and a visual execution history. It beats chaining Lambdas through queues by hand.

:::quiz
q: Where should you create a boto3 client in a Lambda function?
+ at module level, outside the handler, so warm invocations reuse it
- inside the handler on every call
- in a layer only
- in an environment variable
why: Init code runs once per execution environment; reuse saves latency.
:::

:::quiz
q: An SQS-triggered Lambda takes up to 60 s, but the queue's visibility timeout is 30 s. What happens?
- nothing; Lambda extends it automatically
+ messages become visible again while still being processed and get processed twice
- the function is throttled
- messages go straight to the DLQ
why: Set the visibility timeout well above processing time (6× the function timeout for Lambda).
:::

:::quiz
q: Why must SQS consumers be idempotent?
+ standard queues deliver at least once, so the same message can be processed more than once
- SQS encrypts messages
- FIFO queues require it
- messages expire after one read
why: Duplicates happen with retries and visibility timeouts; design for them.
:::

:::quiz
q: What does a dead-letter queue hold?
- messages waiting for their first delivery
+ messages that failed processing more than maxReceiveCount times
- deleted messages
- messages from FIFO queues only
why: The DLQ quarantines poison messages so they stop blocking and retrying.
:::

:::quiz
q: One event must reach the email service, the analytics pipeline and the warehouse system, each processing independently. Which pattern?
- one SQS queue with three consumers
+ an SNS topic (or EventBridge rule) fanning out to one SQS queue per consumer
- three Lambda functions calling each other
- a DynamoDB table
why: Competing consumers on one queue split the messages; fan-out gives each consumer its own copy.
:::

:::exercise
id: al-handler
level: 2
title: An API Gateway handler
mode: code
lang: python
file: handler.py
---
Write `handler(event, context)` for an HTTP API route `GET /hello`: read the query parameter `name` from `event.get("queryStringParameters") or {}` (default `"world"`), and return `statusCode` 200 with `body` = `json.dumps({"message": f"hello {name}"})`.
---starter
import json
---rule
def\s+handler\(\s*event\s*,\s*context\s*\)
`def handler(event, context)`
---rule
event\.get\(\s*["']queryStringParameters["']\s*\)\s+or\s+\{\s*\}
`event.get("queryStringParameters") or {}`
---rule
\.get\(\s*["']name["']\s*,\s*["']world["']\s*\)
Default `name` to `"world"`
---rule
["']statusCode["']\s*:\s*200
`"statusCode": 200`
---rule
["']body["']\s*:\s*json\.dumps\(\s*\{\s*["']message["']\s*:\s*f["']hello \{name\}["']\s*\}\s*\)
`"body": json.dumps({"message": f"hello {name}"})`
---solution
import json


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    name = params.get("name", "world")
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"message": f"hello {name}"}),
    }
:::

:::exercise
id: al-init
level: 2
title: Reuse the client
mode: code
lang: python
file: handler.py
---
This function creates a DynamoDB table resource on **every** invocation. Move `table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])` to module level so warm invocations reuse it.
---starter
import os

import boto3


def handler(event, context):
    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    return table.get_item(Key={"id": event["id"]}).get("Item")
---rule
^table\s*=\s*boto3\.resource\(\s*["']dynamodb["']\s*\)\.Table\(\s*os\.environ\[\s*["']TABLE_NAME["']\s*\]\s*\)
`table = ...` at module level (no indentation)
---rule
!^[ \t]+table\s*=\s*boto3\.resource
Not created inside the handler
---rule
return\s+table\.get_item\(
Still uses `table`
---solution
import os

import boto3

table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])


def handler(event, context):
    return table.get_item(Key={"id": event["id"]}).get("Item")
:::

:::exercise
id: al-batch
level: 3
title: Partial batch failures
mode: code
lang: python
file: worker.py
---
Make the SQS handler report **only the failed messages**: process each record inside `try`, collect `{"itemIdentifier": record["messageId"]}` for failures, and return `{"batchItemFailures": failures}`.
---starter
import json


def handler(event, context):
    for record in event["Records"]:
        process(json.loads(record["body"]))
---rule
failures\s*=\s*\[\s*\]
`failures = []`
---rule
try\s*:\s*\n\s+process\(\s*json\.loads\(\s*record\[\s*["']body["']\s*\]\s*\)\s*\)
`process(...)` inside `try:`
---rule
except\s+Exception
`except Exception`
---rule
failures\.append\(\s*\{\s*["']itemIdentifier["']\s*:\s*record\[\s*["']messageId["']\s*\]\s*\}\s*\)
Collect the message ID
---rule
return\s*\{\s*["']batchItemFailures["']\s*:\s*failures\s*\}
Return `batchItemFailures`
---solution
import json


def handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            process(json.loads(record["body"]))
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
:::

:::exercise
id: al-dlq
level: 3
title: A queue with a DLQ
mode: code
lang: json
file: queue-attributes.json
---
Write the SQS attributes JSON for a queue with a **visibility timeout of 360** seconds and a redrive policy sending messages to the DLQ `arn:aws:sqs:eu-west-1:123456789012:orders-dlq` after **5** receives. (Attribute values are strings; `RedrivePolicy` is itself a JSON **string**.)
---starter
{
}
---rule
"VisibilityTimeout"\s*:\s*"360"
`"VisibilityTimeout": "360"`
---rule
"RedrivePolicy"\s*:\s*"\{
`RedrivePolicy` as a JSON string
---rule
\\"deadLetterTargetArn\\"\s*:\s*\\"arn:aws:sqs:eu-west-1:123456789012:orders-dlq\\"
`deadLetterTargetArn` (escaped quotes)
---rule
\\"maxReceiveCount\\"\s*:\s*(\\"5\\"|5)
`maxReceiveCount` 5
---solution
{
  "VisibilityTimeout": "360",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:eu-west-1:123456789012:orders-dlq\",\"maxReceiveCount\":\"5\"}"
}
:::

:::exercise
id: al-send
level: 2
title: Enqueue a job
mode: code
lang: python
file: producer.py
---
Write `enqueue(order_id: str)` that sends a message to `QUEUE_URL` whose body is `json.dumps({"order_id": order_id})`.
---starter
import json

import boto3

sqs = boto3.client("sqs")
QUEUE_URL = "https://sqs.eu-west-1.amazonaws.com/123456789012/orders"
---rule
def\s+enqueue\(\s*order_id\s*:\s*str\s*\)
`def enqueue(order_id: str)`
---rule
sqs\.send_message\(\s*QueueUrl\s*=\s*QUEUE_URL\s*,\s*MessageBody\s*=\s*json\.dumps\(\s*\{\s*["']order_id["']\s*:\s*order_id\s*\}\s*\)\s*\)
`sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps({"order_id": order_id}))`
---solution
import json

import boto3

sqs = boto3.client("sqs")
QUEUE_URL = "https://sqs.eu-west-1.amazonaws.com/123456789012/orders"


def enqueue(order_id: str):
    sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps({"order_id": order_id}))
:::

:::exercise
id: al-pattern
level: 3
title: An EventBridge pattern
mode: code
lang: json
file: pattern.json
---
Write an event pattern matching events with source `shop.payments`, detail-type `PaymentFailed`, and `detail.attempts` **greater than or equal to 3** (numeric matching).
---starter
{
}
---rule
"source"\s*:\s*\[\s*"shop\.payments"\s*\]
`"source": ["shop.payments"]`
---rule
"detail-type"\s*:\s*\[\s*"PaymentFailed"\s*\]
`"detail-type": ["PaymentFailed"]`
---rule
"detail"\s*:\s*\{\s*"attempts"\s*:\s*\[\s*\{\s*"numeric"\s*:\s*\[\s*">="\s*,\s*3\s*\]\s*\}\s*\]\s*\}
`"detail": {"attempts": [{"numeric": [">=", 3]}]}`
---solution
{
  "source": ["shop.payments"],
  "detail-type": ["PaymentFailed"],
  "detail": {
    "attempts": [{ "numeric": [">=", 3] }]
  }
}
:::

:::exercise
id: al-visibility
level: 2
title: Size the visibility timeout
mode: answer
---
A Lambda function consuming an SQS queue has a timeout of 30 seconds. Using AWS's guideline of 6× the function timeout, what visibility timeout (in seconds) should the queue have?
---answer
180
---solution
180
:::

:::exercise
id: al-sync
level: 2
title: Sync or async?
mode: answer
---
Is a Lambda function invoked by an **S3 object-created event** invoked synchronously or asynchronously?
---answer
asynchronously
---answer
async
---answer
asynchronous
---solution
asynchronously
---explain
S3 invokes Lambda asynchronously, so Lambda handles retries (twice) and on-failure destinations.
:::
