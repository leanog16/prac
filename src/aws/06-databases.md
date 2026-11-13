---
id: aws-databases
title: RDS, Aurora & DynamoDB
summary: Managed relational databases with RDS and Aurora, Multi-AZ vs read replicas, backups and point-in-time restore, credentials in Secrets Manager, connection pooling with RDS Proxy; DynamoDB tables, partition and sort keys, access-pattern-first design, queries vs scans, GSIs, capacity modes, conditional writes and TTL; and ElastiCache.
minutes: 45
---
> [!project] Taskboard, step 6: a managed PostgreSQL
> Taskboard's data moves to Amazon RDS for PostgreSQL: Multi-AZ, encrypted, in the isolated subnets, with its password in Secrets Manager. You'll also see when DynamoDB would be the better fit, using Taskboard's activity feed.

## RDS: managed relational databases

**Amazon RDS** runs PostgreSQL, MySQL, MariaDB, Oracle or SQL Server for you: provisioning, patching, backups, failover and monitoring. You still own the schema, queries, indexes and sizing.

### Multi-AZ vs read replicas

| | Multi-AZ | Read replica |
|---|---|---|
| Purpose | **availability**: survive an AZ or instance failure | **read scaling** (and cross-region DR) |
| Replication | synchronous to a standby | asynchronous (replica lag) |
| Can you query the standby? | no (classic Multi-AZ); yes with Multi-AZ **cluster** deployments | yes, read-only |
| Failover | automatic, ~60 s, same DNS endpoint | manual promotion |

Production databases should be Multi-AZ. Read replicas are for offloading reporting or read-heavy endpoints, and your code must tolerate slightly stale reads.

### Backups and restore

- **Automated backups** (retention 1–35 days) enable **point-in-time restore** to any second within the window.
- **Manual snapshots** persist until you delete them; copy them to another region or account for disaster recovery.
- A restore always creates a **new** DB instance with a new endpoint. Practice it: an untested backup isn't a backup.
- Turn on **deletion protection** for production.

### Networking and credentials

- Put RDS in **isolated subnets** (a DB subnet group spanning 2+ AZs), with `PubliclyAccessible = false` and a security group that only allows the app tier.
- Store credentials in **AWS Secrets Manager**, with automatic rotation, and have the app fetch them at startup (or let RDS manage the master password in Secrets Manager for you). Never put them in code, AMIs or plain environment files.
- Enable **encryption at rest** (KMS) when creating the instance; it can't be switched on in place later.

```python
import json, boto3

def db_url() -> str:
    secret = boto3.client("secretsmanager").get_secret_value(SecretId="prod/shop/db")
    s = json.loads(secret["SecretString"])
    return f"postgresql://{s['username']}:{s['password']}@{s['host']}:{s['port']}/{s['dbname']}"
```

### Connections

Each database connection costs server memory. Fifty containers with a pool of 20 each is 1,000 connections, and Lambda can open far more. **RDS Proxy** pools and shares connections in front of RDS/Aurora, smooths failovers, and can authenticate with IAM.

### Aurora

**Aurora** is AWS's cloud-native MySQL/PostgreSQL-compatible engine: storage is replicated 6 ways across 3 AZs and grows automatically, failover is faster, and up to 15 low-lag replicas share the same storage. **Aurora Serverless v2** scales capacity up and down in fine increments, which suits spiky or dev/test workloads.

## DynamoDB: key-value at any scale

**DynamoDB** is a fully managed NoSQL database: single-digit-millisecond reads and writes at any scale, no servers or connections to manage, pay per request or per provisioned capacity.

### Keys

Every item is identified by its **primary key**:

- **Partition key** only (`user_id`): items are spread across partitions by a hash of this key.
- **Partition key + sort key** (`customer_id` + `order_date`): items with the same partition key are stored together, **sorted** by the sort key, so you can query ranges ("this customer's orders in November").

```bash
aws dynamodb create-table --table-name Orders \
  --attribute-definitions AttributeName=customer_id,AttributeType=S AttributeName=order_date,AttributeType=S \
  --key-schema AttributeName=customer_id,KeyType=HASH AttributeName=order_date,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

### Design for access patterns first

In SQL you normalize data and write any query later. In DynamoDB you **list your access patterns first** and design keys so each pattern is a single `GetItem` or `Query`:

| Access pattern | Operation |
|---|---|
| get an order by customer and date | `GetItem(customer_id, order_date)` |
| a customer's orders, newest first | `Query(customer_id, ScanIndexForward=false)` |
| a customer's orders in November | `Query(customer_id, order_date BETWEEN '2026-11-01' AND '2026-11-30')` |
| all orders with status `PENDING` | a **GSI** with partition key `status` |

### Query vs Scan

```python
from boto3.dynamodb.conditions import Key

table = boto3.resource("dynamodb").Table("Orders")

resp = table.query(
    KeyConditionExpression=Key("customer_id").eq("c-42") & Key("order_date").begins_with("2026-11"),
    ScanIndexForward=False,
    Limit=20,
)
items = resp["Items"]            # follow resp.get("LastEvaluatedKey") to paginate
```

A **Query** reads only the items under one partition key: fast and cheap. A **Scan** reads the **entire table** and filters afterwards, so you pay for every item read. Scans are fine for small tables and one-off jobs, never for a request path.

### Secondary indexes

- **Global secondary index (GSI)**: a different partition (and optional sort) key, maintained automatically and eventually consistent. Most extra access patterns become a GSI.
- **Local secondary index (LSI)**: same partition key, different sort key; must be defined at table creation.

Hot partitions happen when one partition key gets most of the traffic (a `status` GSI where 95% of items are `DONE`). Choose high-cardinality keys, or add a suffix to spread writes.

### Writes, conditions and TTL

```python
table.put_item(
    Item={"customer_id": "c-42", "order_date": "2026-11-13T10:00:00Z", "total": 4999, "status": "PENDING"},
    ConditionExpression="attribute_not_exists(customer_id)",       # don't overwrite an existing order
)

table.update_item(
    Key={"customer_id": "c-42", "order_date": "2026-11-13T10:00:00Z"},
    UpdateExpression="SET #s = :new",
    ConditionExpression="#s = :old",                                  # optimistic concurrency
    ExpressionAttributeNames={"#s": "status"},
    ExpressionAttributeValues={":new": "PAID", ":old": "PENDING"},
)
```

- **Conditional writes** give you uniqueness and optimistic locking; a failed condition raises `ConditionalCheckFailedException`.
- `TransactWriteItems` makes up to 100 writes atomic.
- **TTL**: set an attribute (e.g. `expires_at`, epoch seconds) and DynamoDB deletes expired items for free. Great for sessions and idempotency keys.
- Reads are **eventually consistent** by default; `ConsistentRead=True` (base table only) costs double.

### Capacity

- **On-demand** (`PAY_PER_REQUEST`): pay per read/write, no planning. The default choice for new or spiky tables.
- **Provisioned** with auto scaling: cheaper for steady, predictable traffic.

## Choosing

| Need | Choose |
|---|---|
| relational data, joins, ad-hoc queries, transactions across tables | RDS PostgreSQL / Aurora |
| known access patterns, huge scale, simple key lookups, serverless | DynamoDB |
| sub-millisecond cache, sessions, rate-limit counters, leaderboards | **ElastiCache** (Redis/Valkey) |
| full-text search | OpenSearch |

## Worked example: Taskboard's RDS settings, justified

| Setting | Taskboard prod | Why |
|---|---|---|
| engine | PostgreSQL 16 | same as local Docker and CI, no surprises |
| instance | `db.t4g.medium` | Graviton, burstable; resize later from metrics |
| Multi-AZ | yes | survives an AZ outage with automatic failover |
| storage | gp3, 50 GB, autoscaling to 200 GB | grows without an outage |
| encryption | on (KMS) | can't be enabled later |
| subnets | the two **isolated** subnets | no route to the internet at all |
| security group | `sg-db`, 5432 from `sg-api` only | from lesson 4 |
| credentials | `--manage-master-user-password` | RDS stores and rotates the password in Secrets Manager |
| backups | 14 days, point-in-time restore | recover from bad deploys and mistakes |
| deletion protection | on | `delete-db-instance` refuses until disabled |

```bash
aws rds create-db-instance --db-instance-identifier taskboard-prod \
  --engine postgres --engine-version 16.4 --db-instance-class db.t4g.medium \
  --allocated-storage 50 --max-allocated-storage 200 --storage-type gp3 \
  --multi-az --storage-encrypted \
  --db-subnet-group-name taskboard-isolated --vpc-security-group-ids sg-0db \
  --master-username taskboard --manage-master-user-password \
  --backup-retention-period 14 --deletion-protection --no-publicly-accessible
```

## Worked example: when DynamoDB fits better

Taskboard's **activity feed** ("Ada moved *Write docs* to done, 2 minutes ago") is append-only, read newest-first per board, high-volume, and never joined with anything. That's DynamoDB's sweet spot:

| Access pattern | Key design |
|---|---|
| a board's latest events | partition key `board_id`, sort key `ts` (ISO timestamp), `Query` with `ScanIndexForward=False` |
| expire events after 90 days | TTL attribute `expires_at` |

Tasks themselves stay in PostgreSQL: they're relational (users, comments, attachments) and queried in flexible ways. Using two databases for two different shapes of data is normal; using a database because it's fashionable isn't.

> [!plain] In plain English
> RDS is PostgreSQL that AWS operates for you: backups, patches, failover. DynamoDB is a different kind of database: blazing fast for questions you planned for, awkward for ones you didn't.

:::quiz
q: What does RDS Multi-AZ primarily give you?
+ automatic failover to a synchronous standby in another AZ
- more read capacity
- cross-region replication
- cheaper storage
why: Multi-AZ is about availability; read replicas are about read scaling.
:::

:::quiz
q: Where should an app get its RDS password?
- an environment variable baked into the image
- the source code
+ AWS Secrets Manager (with rotation), read at runtime via the app's IAM role
- the AMI
why: Secrets Manager centralizes, audits and rotates credentials.
:::

:::quiz
q: Why is a DynamoDB Scan on a request path a bad idea?
+ it reads every item in the table, so cost and latency grow with table size
- it's not supported by the SDK
- it locks the table
- it can't filter
why: Use Query on a key (or a GSI) so you read only matching items.
:::

:::quiz
q: Which DynamoDB feature prevents overwriting an existing item on put?
- TTL
- a GSI
+ a condition expression like `attribute_not_exists(pk)`
- ConsistentRead
why: Conditional writes fail with ConditionalCheckFailedException instead of overwriting.
:::

:::exercise
id: adb-create-table
level: 2
title: A table with a sort key
mode: code
lang: bash
file: create-table.sh
---
Create the on-demand DynamoDB table `Events` with partition key `device_id` (string) and sort key `ts` (number).
---starter
#!/bin/sh
---rule
aws\s+dynamodb\s+create-table
`aws dynamodb create-table`
---rule
--table-name[ =]Events
`--table-name Events`
---rule
AttributeName=device_id,AttributeType=S
`device_id` is a string
---rule
AttributeName=ts,AttributeType=N
`ts` is a number
---rule
AttributeName=device_id,KeyType=HASH
`device_id` is the partition (HASH) key
---rule
AttributeName=ts,KeyType=RANGE
`ts` is the sort (RANGE) key
---rule
--billing-mode[ =]PAY_PER_REQUEST
On-demand billing
---solution
#!/bin/sh
aws dynamodb create-table --table-name Events \
  --attribute-definitions AttributeName=device_id,AttributeType=S AttributeName=ts,AttributeType=N \
  --key-schema AttributeName=device_id,KeyType=HASH AttributeName=ts,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
:::

:::exercise
id: adb-query
level: 3
title: Query, don't scan
mode: code
lang: python
file: events.py
---
Rewrite `recent_events` to use a **Query** on `device_id` equal to the argument, newest first (`ScanIndexForward=False`), limited to `limit` items, returning `resp["Items"]`. Remove the scan.
---starter
import boto3
from boto3.dynamodb.conditions import Attr, Key

table = boto3.resource("dynamodb").Table("Events")


def recent_events(device_id: str, limit: int = 50):
    resp = table.scan(FilterExpression=Attr("device_id").eq(device_id))
    return sorted(resp["Items"], key=lambda i: i["ts"], reverse=True)[:limit]
---rule
table\.query\(
`table.query(...)`
---rule
KeyConditionExpression\s*=\s*Key\(\s*["']device_id["']\s*\)\.eq\(\s*device_id\s*\)
`KeyConditionExpression=Key("device_id").eq(device_id)`
---rule
ScanIndexForward\s*=\s*False
`ScanIndexForward=False`
---rule
Limit\s*=\s*limit
`Limit=limit`
---rule
return\s+\w+\[\s*["']Items["']\s*\]
Return the items
---rule
!table\.scan\(
No scan
---solution
import boto3
from boto3.dynamodb.conditions import Attr, Key

table = boto3.resource("dynamodb").Table("Events")


def recent_events(device_id: str, limit: int = 50):
    resp = table.query(
        KeyConditionExpression=Key("device_id").eq(device_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return resp["Items"]
:::

:::exercise
id: adb-conditional
level: 3
title: Idempotent create
mode: code
lang: python
file: payments.py
---
Make `record_payment` refuse to overwrite an existing payment: add `ConditionExpression="attribute_not_exists(payment_id)"` to `put_item`, catch `ClientError`, and if its error code (`e.response["Error"]["Code"]`) is `"ConditionalCheckFailedException"` return `False`; otherwise re-raise. Return `True` on success.
---starter
import boto3
from botocore.exceptions import ClientError

table = boto3.resource("dynamodb").Table("Payments")


def record_payment(payment_id: str, amount: int) -> bool:
    table.put_item(Item={"payment_id": payment_id, "amount": amount})
    return True
---rule
ConditionExpression\s*=\s*["']attribute_not_exists\(payment_id\)["']
The condition expression
---rule
try\s*:\s*\n\s+table\.put_item\(
`put_item` inside `try:`
---rule
except\s+ClientError\s+as\s+e\s*:
`except ClientError as e:`
---rule
e\.response\[\s*["']Error["']\s*\]\[\s*["']Code["']\s*\]\s*==\s*["']ConditionalCheckFailedException["']
Check the error code
---rule
return\s+False
Return `False` for duplicates
---rule
^\s+raise\s*$
Re-raise other errors
---solution
import boto3
from botocore.exceptions import ClientError

table = boto3.resource("dynamodb").Table("Payments")


def record_payment(payment_id: str, amount: int) -> bool:
    try:
        table.put_item(
            Item={"payment_id": payment_id, "amount": amount},
            ConditionExpression="attribute_not_exists(payment_id)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
    return True
:::

:::exercise
id: adb-secret
level: 2
title: Read the DB secret
mode: code
lang: python
file: config.py
---
Write `db_password()` that fetches the secret `prod/shop/db` from Secrets Manager with `get_secret_value(SecretId=...)`, parses `SecretString` as JSON, and returns its `"password"` field.
---starter
import json

import boto3
---rule
boto3\.client\(\s*["']secretsmanager["']\s*\)
A Secrets Manager client
---rule
get_secret_value\(\s*SecretId\s*=\s*["']prod/shop/db["']\s*\)
`get_secret_value(SecretId="prod/shop/db")`
---rule
json\.loads\(\s*\w+\[\s*["']SecretString["']\s*\]\s*\)
Parse `SecretString`
---rule
\[\s*["']password["']\s*\]
Return the password
---rule
def\s+db_password\(\s*\)
`def db_password()`
---solution
import json

import boto3


def db_password() -> str:
    resp = boto3.client("secretsmanager").get_secret_value(SecretId="prod/shop/db")
    return json.loads(resp["SecretString"])["password"]
:::

:::exercise
id: adb-snapshot
level: 2
title: Snapshot before a migration
mode: code
lang: bash
file: pre-migrate.sh
---
Take a manual snapshot named `shop-pre-v42` of the RDS instance `shop-prod`, then wait until it's available.
---starter
#!/bin/sh
set -e
---rule
aws\s+rds\s+create-db-snapshot
`aws rds create-db-snapshot`
---rule
--db-instance-identifier[ =]shop-prod
`--db-instance-identifier shop-prod`
---rule
--db-snapshot-identifier[ =]shop-pre-v42
`--db-snapshot-identifier shop-pre-v42`
---rule
aws\s+rds\s+wait\s+db-snapshot-available\s+(?=[^\n]*--db-snapshot-identifier[ =]shop-pre-v42)
`aws rds wait db-snapshot-available --db-snapshot-identifier shop-pre-v42`
---solution
#!/bin/sh
set -e
aws rds create-db-snapshot --db-instance-identifier shop-prod --db-snapshot-identifier shop-pre-v42
aws rds wait db-snapshot-available --db-snapshot-identifier shop-pre-v42
:::

:::exercise
id: adb-choose
level: 2
title: Multi-AZ or replica?
mode: answer
---
Your reporting dashboard runs heavy queries that slow down the production PostgreSQL database. Which RDS feature offloads them: **Multi-AZ** or a **read replica**?
---answer
read replica
---answer
a read replica
---solution
read replica
:::

:::exercise
id: adb-gsi
level: 3
title: A new access pattern
mode: answer
---
The `Orders` table has partition key `customer_id` and sort key `order_date`. Support staff now need "all orders with status `DISPUTED`, newest first" without scanning. What do you add? (Three letters.)
---answer
GSI
---answer
global secondary index
---answer
a GSI
---solution
GSI
---explain
A global secondary index with partition key `status` and sort key `order_date`. (A sparse index, holding only disputed orders, avoids a hot `status` partition.)
:::

:::exercise
id: proj-aws-06-rds
level: 4
title: "Project 6: create Taskboard's database"
mode: code
lang: bash
file: create-db.sh
---
Write the `aws rds create-db-instance` command for `taskboard-prod`: engine `postgres`, class `db.t4g.medium`, 50 GB gp3 storage, **Multi-AZ**, **encrypted**, subnet group `taskboard-isolated`, security group `sg-0db`, master user `taskboard` with the password **managed by RDS**, 14 days of backups, deletion protection, and **not** publicly accessible.
---starter
#!/bin/sh
---rule
aws\s+rds\s+create-db-instance
`aws rds create-db-instance`
---rule
--db-instance-identifier[ =]taskboard-prod
Identifier
---rule
--engine[ =]postgres\b
PostgreSQL
---rule
--db-instance-class[ =]db\.t4g\.medium
Instance class
---rule
--allocated-storage[ =]50\b
50 GB
---rule
--storage-type[ =]gp3
gp3
---rule
--multi-az\b
Multi-AZ
---rule
--storage-encrypted
Encrypted
---rule
--db-subnet-group-name[ =]taskboard-isolated
Isolated subnets
---rule
--vpc-security-group-ids[ =]sg-0db
Security group
---rule
--master-username[ =]taskboard
Master user
---rule
--manage-master-user-password
RDS-managed password
---rule
--backup-retention-period[ =]14
14 days of backups
---rule
--deletion-protection
Deletion protection
---rule
--no-publicly-accessible
Not public
---rule
!--master-user-password
No password on the command line
---solution
#!/bin/sh
aws rds create-db-instance --db-instance-identifier taskboard-prod \
  --engine postgres --db-instance-class db.t4g.medium \
  --allocated-storage 50 --storage-type gp3 \
  --multi-az --storage-encrypted \
  --db-subnet-group-name taskboard-isolated --vpc-security-group-ids sg-0db \
  --master-username taskboard --manage-master-user-password \
  --backup-retention-period 14 --deletion-protection --no-publicly-accessible
:::

:::exercise
id: proj-aws-06-feed
level: 3
title: "Project 6b: the activity feed query"
mode: code
lang: python
file: feed.py
---
Write `latest_events(board_id: str, limit: int = 20)` that queries the DynamoDB table `TaskEvents` for `board_id` (partition key), **newest first**, at most `limit` items, returning `resp["Items"]`.
---starter
import boto3
from boto3.dynamodb.conditions import Key

table = boto3.resource("dynamodb").Table("TaskEvents")
---rule
def\s+latest_events\(\s*board_id\s*:\s*str\s*,\s*limit\s*:\s*int\s*=\s*20\s*\)
The signature
---rule
table\.query\(
A query, not a scan
---rule
KeyConditionExpression\s*=\s*Key\(\s*["']board_id["']\s*\)\.eq\(\s*board_id\s*\)
Key condition on `board_id`
---rule
ScanIndexForward\s*=\s*False
Newest first
---rule
Limit\s*=\s*limit
Limit
---rule
return\s+\w+\[\s*["']Items["']\s*\]
Return the items
---rule
!\.scan\(
No scan
---solution
import boto3
from boto3.dynamodb.conditions import Key

table = boto3.resource("dynamodb").Table("TaskEvents")


def latest_events(board_id: str, limit: int = 20):
    resp = table.query(
        KeyConditionExpression=Key("board_id").eq(board_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return resp["Items"]
:::
