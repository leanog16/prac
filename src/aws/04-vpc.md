---
id: aws-vpc
title: VPC networking
summary: VPCs and CIDR blocks, public, private and isolated subnets across AZs, route tables, internet and NAT gateways, security groups vs network ACLs, VPC endpoints for S3 and other services, peering and Transit Gateway, Route 53 DNS, and the standard three-tier layout.
minutes: 40
---
> [!project] Taskboard, step 4: Taskboard's network
> Production Taskboard gets a proper VPC: public subnets for the load balancer, private subnets for the API tasks, isolated subnets for the database, in two Availability Zones, with security groups that only allow the traffic the architecture needs.

## A VPC is your private network

A **Virtual Private Cloud (VPC)** is an isolated network in one region, with an IP range you choose as a **CIDR block**:

| CIDR | Addresses | Typical use |
|---|---|---|
| `10.0.0.0/16` | 65,536 | a whole VPC |
| `10.0.1.0/24` | 256 (251 usable: AWS reserves 5 per subnet) | one subnet |
| `10.0.0.0/28` | 16 | the smallest subnet AWS allows |

The number after the slash is how many leading bits are fixed: a smaller suffix means a bigger range. Use private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and plan them so VPCs you might ever connect **don't overlap**.

## Subnets

A **subnet** is a slice of the VPC's range in **one AZ**. Whether it's "public" or "private" depends entirely on its **route table**:

| Subnet | Default route (`0.0.0.0/0`) goes to | Contains |
|---|---|---|
| **public** | an **internet gateway** | load balancers, NAT gateways, bastions |
| **private** | a **NAT gateway** (outbound only) | app servers, containers, Lambda in a VPC |
| **isolated** | nowhere: only local VPC traffic | databases, caches |

The standard layout is **three tiers × two or three AZs**:

```
VPC 10.0.0.0/16 (eu-west-1)
├── public-a   10.0.0.0/24    public-b   10.0.1.0/24     ALB, NAT gateways
├── private-a  10.0.10.0/24   private-b  10.0.11.0/24    ECS tasks / EC2 app servers
└── db-a       10.0.20.0/24   db-b       10.0.21.0/24    RDS (Multi-AZ), ElastiCache
```

Only the load balancer is reachable from the internet. App servers can make outbound calls (package installs, third-party APIs) through NAT but can't be reached directly. Databases can only be reached from the app tier.

## Gateways and route tables

```
Route table "public":                 Route table "private-a":
10.0.0.0/16   local                    10.0.0.0/16   local
0.0.0.0/0     igw-0abc (internet gw)   0.0.0.0/0     nat-0aaa (NAT gateway in public-a)
```

- **Internet gateway (IGW)**: two-way internet access for resources **with public IPs** in public subnets. One per VPC, free.
- **NAT gateway**: lets private resources start **outbound** connections; nothing can connect in. It lives in a public subnet, is zonal (one per AZ for high availability), and costs per hour **plus per GB processed**, which is often a surprisingly large line on the bill.
- The `local` route (the VPC's own CIDR) is always there: all subnets in a VPC can reach each other, subject to security groups and NACLs.

```bash
aws ec2 create-route --route-table-id rtb-0priv \
  --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-0aaa
```

## Security groups vs network ACLs

| | Security group | Network ACL |
|---|---|---|
| Attached to | network interfaces (instances, tasks, RDS…) | subnets |
| Rules | allow only | allow **and** deny |
| State | **stateful**: replies allowed automatically | **stateless**: replies need their own rules (ephemeral ports 1024–65535) |
| Evaluation | all rules together | in number order, first match wins |
| Typical use | your main firewall, referencing other SGs | coarse subnet-level blocks (e.g. deny a malicious CIDR) |

Most designs use security groups for everything and leave NACLs at the default (allow all).

## VPC endpoints: reach AWS services privately

Without endpoints, a private instance calling S3 or DynamoDB goes through the NAT gateway (paying per GB) and out to the public service endpoint. **VPC endpoints** keep that traffic inside AWS:

- **Gateway endpoints** for **S3** and **DynamoDB**: free; added as routes in your route tables.
- **Interface endpoints** (PrivateLink) for most other services (ECR, Secrets Manager, SQS, CloudWatch Logs, STS…): an elastic network interface in your subnet, billed per hour and per GB.

```bash
aws ec2 create-vpc-endpoint --vpc-id vpc-0abc \
  --service-name com.amazonaws.eu-west-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-0priv-a rtb-0priv-b
```

Bucket policies can then require access through the endpoint (`aws:SourceVpce`), so the bucket is unreachable from anywhere else.

## Connecting networks

- **VPC peering**: a private link between two VPCs (same or different accounts/regions). Not transitive: if A peers with B and B with C, A can't reach C. CIDRs must not overlap.
- **Transit Gateway**: a regional hub that many VPCs and VPNs attach to, which scales better than a mesh of peerings.
- **Site-to-Site VPN** / **Direct Connect**: connect your on-premises network.

## DNS with Route 53

**Route 53** is AWS's DNS service:

- **Public hosted zones** answer for your domain on the internet; **private hosted zones** answer only inside chosen VPCs (`db.internal.acme`).
- **Alias records** point a name (including the zone apex, `example.com`) at AWS resources like an ALB, CloudFront distribution or S3 website, for free and following their IP changes.
- **Routing policies**: simple, weighted (canary traffic splits), latency-based, failover (with health checks), geolocation.

## Debugging connectivity

When "it can't connect", walk the path:

1. **DNS**: does the name resolve to the address you expect?
2. **Route table** of the source subnet: is there a route to the destination (IGW, NAT, peering, endpoint)?
3. **Security group** of the destination: is the port allowed from the source (SG or CIDR)?
4. **NACLs** on both subnets, in **both** directions (stateless!).
5. Is the target **listening** on that port and interface (not just 127.0.0.1)?

**VPC Reachability Analyzer** checks this path for you, and **VPC Flow Logs** record accepted and rejected traffic.

## Worked example: planning the address space

Pick a VPC range that won't collide with the office network or other VPCs you may peer with later, then carve it up. Leave room to grow:

| Subnet | AZ a | AZ b | Route `0.0.0.0/0` → | Holds |
|---|---|---|---|---|
| public | `10.20.0.0/24` | `10.20.1.0/24` | internet gateway | ALB, NAT gateways |
| private | `10.20.10.0/24` | `10.20.11.0/24` | NAT gateway (same AZ) | ECS tasks |
| isolated | `10.20.20.0/24` | `10.20.21.0/24` | none | RDS |

VPC: `10.20.0.0/16` (65,536 addresses; we use 6 × 256 and keep the rest for later).

## Worked example: security groups as a chain

```
internet ──443──► sg-alb ──8000──► sg-api ──5432──► sg-db
```

| Group | Inbound rule | Source |
|---|---|---|
| `sg-alb` | TCP 443 | `0.0.0.0/0` |
| `sg-api` | TCP 8000 | **`sg-alb`** (the group, not an IP range) |
| `sg-db` | TCP 5432 | **`sg-api`** |

Each tier accepts traffic only from the tier in front of it. Even if someone launched something else in the private subnet, it couldn't reach the database, because it isn't in `sg-api`. Referencing groups instead of CIDRs also keeps working as tasks come and go with new IPs.

> [!plain] In plain English
> Subnets decide **where** things live and how traffic is routed; security groups decide **who may talk to whom**. Good designs use both.

:::quiz
q: What makes a subnet "public"?
- it has a public CIDR block
+ its route table sends 0.0.0.0/0 to an internet gateway
- it contains a load balancer
- it's in the first AZ
why: Public vs private is purely about routing.
:::

:::quiz
q: How many IP addresses can you use in a /24 subnet on AWS?
- 256
- 254
+ 251
- 128
why: 256 addresses minus the 5 AWS reserves in every subnet.
:::

:::quiz
q: Private app servers need to download packages from the internet but must not be reachable from it. What do they route through?
- an internet gateway
+ a NAT gateway in a public subnet
- a VPC peering connection
- a gateway endpoint
why: NAT allows outbound-initiated connections only.
:::

:::quiz
q: A network ACL allows inbound TCP 443 but has no outbound rules beyond the default deny. What happens to HTTPS requests?
- they work, because ACLs are stateful
+ responses are blocked, because ACLs are stateless and need outbound rules for ephemeral ports
- only IPv6 works
- the security group takes over
why: NACLs evaluate each direction independently.
:::

:::quiz
q: Which VPC endpoint type is free and used for S3 and DynamoDB?
+ gateway endpoint
- interface endpoint
- transit gateway attachment
- NAT gateway
why: Gateway endpoints are route-table entries at no charge.
:::

:::exercise
id: av-cidr-size
level: 2
title: How big is it?
mode: answer
---
How many IP addresses (total, before AWS reservations) does the CIDR block `10.0.0.0/20` contain?
---answer
4096
---solution
4096
---explain
32 − 20 = 12 free bits, and 2¹² = 4096.
:::

:::exercise
id: av-route-nat
level: 2
title: Route private traffic through NAT
mode: code
lang: bash
file: routes.sh
---
In route table `rtb-0priv`, add a default route (`0.0.0.0/0`) to the NAT gateway `nat-0aaa`.
---starter
#!/bin/sh
---rule
aws\s+ec2\s+create-route
`aws ec2 create-route`
---rule
--route-table-id[ =]rtb-0priv
`--route-table-id rtb-0priv`
---rule
--destination-cidr-block[ =]0\.0\.0\.0/0
`--destination-cidr-block 0.0.0.0/0`
---rule
--nat-gateway-id[ =]nat-0aaa
`--nat-gateway-id nat-0aaa`
---solution
#!/bin/sh
aws ec2 create-route --route-table-id rtb-0priv --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-0aaa
:::

:::exercise
id: av-s3-endpoint
level: 3
title: Keep S3 traffic off the NAT
mode: code
lang: bash
file: endpoint.sh
---
Create a **gateway** VPC endpoint for S3 in `eu-west-1` for `vpc-0abc`, attached to route tables `rtb-0a` and `rtb-0b`.
---starter
#!/bin/sh
---rule
aws\s+ec2\s+create-vpc-endpoint
`aws ec2 create-vpc-endpoint`
---rule
--vpc-id[ =]vpc-0abc
`--vpc-id vpc-0abc`
---rule
--service-name[ =]com\.amazonaws\.eu-west-1\.s3
`--service-name com.amazonaws.eu-west-1.s3`
---rule
--vpc-endpoint-type[ =]Gateway
`--vpc-endpoint-type Gateway`
---rule
--route-table-ids[ =]rtb-0a\s+rtb-0b|--route-table-ids[ =]rtb-0b\s+rtb-0a
Both route tables
---solution
#!/bin/sh
aws ec2 create-vpc-endpoint --vpc-id vpc-0abc --service-name com.amazonaws.eu-west-1.s3 --vpc-endpoint-type Gateway --route-table-ids rtb-0a rtb-0b
:::

:::exercise
id: av-tier
level: 2
title: Which subnet tier?
mode: answer
---
In the three-tier layout, which tier (`public`, `private` or `isolated`) should an RDS database's subnets be in?
---answer
isolated
---solution
isolated
:::

:::exercise
id: av-peering
level: 3
title: Predict: transitive peering
mode: answer
---
VPC A is peered with VPC B, and VPC B is peered with VPC C. All routes and security groups are configured. Can an instance in A reach an instance in C through B? Answer `yes` or `no`.
---answer
no
---solution
no
---explain
Peering isn't transitive. Peer A and C directly, or use a Transit Gateway.
:::

:::exercise
id: av-debug
level: 3
title: Find the broken hop
mode: answer
---
An app in a private subnet can't reach an RDS instance in an isolated subnet of the same VPC on port 5432. Routes are fine (it's local traffic), NACLs are default, and the database is up. Which resource's configuration is most likely wrong? (Two words.)
---answer
security group
---answer
database security group
---answer
the security group
---answer
rds security group
---solution
security group
---explain
The database's security group probably doesn't allow 5432 from the app's security group.
:::

:::exercise
id: proj-aws-04-chain
level: 3
title: "Project 4: the security group chain"
mode: code
lang: bash
file: security-groups.sh
---
Write three ingress rules: `sg-0alb` allows TCP **443** from `0.0.0.0/0`; `sg-0api` allows TCP **8000** from source group `sg-0alb`; `sg-0db` allows TCP **5432** from source group `sg-0api`.
---starter
#!/bin/sh
set -e
---rule
authorize-security-group-ingress\s+(?=[^\n]*--group-id[ =]sg-0alb)(?=[^\n]*--port[ =]443\b)(?=[^\n]*--cidr[ =]0\.0\.0\.0/0)
ALB: 443 from the internet
---rule
authorize-security-group-ingress\s+(?=[^\n]*--group-id[ =]sg-0api)(?=[^\n]*--port[ =]8000\b)(?=[^\n]*--source-group[ =]sg-0alb)
API: 8000 from the ALB group
---rule
authorize-security-group-ingress\s+(?=[^\n]*--group-id[ =]sg-0db)(?=[^\n]*--port[ =]5432\b)(?=[^\n]*--source-group[ =]sg-0api)
DB: 5432 from the API group
---rule
(--protocol[ =]tcp[\s\S]*){3}
TCP on all three
---solution
#!/bin/sh
set -e
aws ec2 authorize-security-group-ingress --group-id sg-0alb --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id sg-0api --protocol tcp --port 8000 --source-group sg-0alb
aws ec2 authorize-security-group-ingress --group-id sg-0db --protocol tcp --port 5432 --source-group sg-0api
:::

:::exercise
id: proj-aws-04-tier
level: 2
title: "Project 4b: where do the tasks go?"
mode: answer
---
In Taskboard's layout, which subnet tier (`public`, `private` or `isolated`) should the ECS API tasks run in, given they must call an external email API on the internet but must not be reachable from it?
---answer
private
---solution
private
:::

:::exercise
id: proj-aws-04-count
level: 2
title: "Project 4c: how much room is left?"
mode: answer
---
The VPC is `10.20.0.0/16` and Taskboard uses six `/24` subnets. How many **more** `/24` subnets could still be created in it?
---answer
250
---solution
250
---explain
A /16 holds 2⁸ = 256 subnets of size /24; 256 − 6 = 250.
:::
