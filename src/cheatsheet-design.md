## The process

1. **Requirements**: functional (what) and non-functional (scale, latency, availability, durability, consistency).
2. **Estimates**: QPS (average and peak), storage over N years, bandwidth, cache size.
3. **API and data model**: endpoints, IDs, schema shaped by access patterns.
4. **Simple design** end to end.
5. **Scale the bottlenecks** one at a time.
6. **Trade-offs, failures, operations**.

## Numbers

| | |
|---|---|
| seconds/day | ~10⁵ |
| seconds/month | ~2.5 × 10⁶ |
| 1 M/day | ~12/s |
| 1 B/day | ~12,000/s |
| peak factor | 2–3× average |
| memory ref / SSD read / DC round trip / cross-ocean | 100 ns / 100 µs / 0.5 ms / 80–200 ms |
| 99.9% / 99.99% / 99.999% | 43 min / 4.4 min / 26 s down per month |
| serial availability | multiply: 0.999 × 0.999 ≈ 0.998 |
| parallel replicas | 1 − (1 − a)ⁿ |

## Building blocks

| Block | Use | Watch out for |
|---|---|---|
| load balancer (L4/L7) | spread traffic, health checks | it must be redundant too |
| stateless app tier | horizontal scaling | sessions/files must live elsewhere |
| CDN | static content, cacheable responses near users | invalidation, stale data |
| cache (Redis) | hot reads: cache-aside, TTL + jitter, LRU | stampedes, hot keys, penetration (negative caching) |
| read replicas | read scaling, failover | replication lag → read-your-writes |
| sharding | write/storage scaling | shard key choice, scatter-gather, resharding (consistent hashing) |
| queue (SQS) | jobs, one consumer each | at-least-once → idempotency, DLQ |
| pub/sub (SNS) | fan-out events | subscribers' failures are independent |
| log (Kafka) | high-volume, ordered per key, replayable | partition count = max parallelism |
| object storage (S3) | files, raw events, backups | not a database |
| search index | full-text and facets | eventually consistent copy |

## Data choices

SQL for relational data and flexible queries · key-value for huge scale by key · document for nested records · wide-column for massive writes · graph for relationships · search for text. **CAP**: under a partition choose consistency or availability. **PACELC**: otherwise latency vs consistency.

## IDs

auto-increment (simple, central) · UUID (no coordination, long) · Snowflake (sortable 64-bit) · random base62 (short; 62⁷ ≈ 3.5 T) · pre-generated key pool.

## Reliability toolkit

timeouts on every call · retries only for transient errors and idempotent operations, exponential backoff + jitter, at one layer · circuit breakers (closed/open/half-open) · bulkheads · token-bucket rate limiting (429 + Retry-After) · load shedding by priority · graceful degradation · health checks · multi-AZ by default · RPO (data loss) and RTO (downtime) · tested backups.

## Architecture

modular monolith first; extract services for concrete scaling, availability or team reasons · boundaries by domain (bounded contexts), share events/APIs not tables · sync for "need an answer now", events for "something happened" · sagas with compensations instead of distributed transactions · transactional outbox for reliable events · hexagonal: core depends on ports, adapters on the core · observability: logs with trace IDs, RED metrics, traces · ADRs for decisions.
