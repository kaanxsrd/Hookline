# Architecture

Hookline is three processes and three stores behind one domain.

```mermaid
flowchart LR
  sender([Webhook sender]) -->|POST /h/slug| caddy
  browser([Dashboard]) --> caddy
  cli([hookline CLI]) -->|/v1/tunnel| caddy
  caddy{{Caddy}} -->|/h/*, /v1/*| edge[Edge · Go]
  caddy -->|everything else| web[Web · Next.js]
  edge --> pg[(PostgreSQL)]
  edge --> redis[(Redis)]
  edge --> s3[(S3 / R2 / MinIO)]
  web --> pg
  web --> redis
  worker[Worker · Go] --> pg
  worker --> s3
  worker -->|forward| dest([Destinations])
```

| Process                        | Responsibility                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **edge** (`services/edge`)     | Webhook intake on `/h/*`, live SSE streams, CLI tunnels, `/healthz`, `/readyz`; Prometheus on a separate internal port |
| **worker** (`services/worker`) | River jobs: forwarding with retries, replays, partition maintenance, retention, usage rollups                          |
| **web** (`apps/web`)           | Marketing site, docs, auth, dashboard, tRPC and the public REST API                                                    |

| Store                     | Holds                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **PostgreSQL 17**         | Everything durable, including the River job queue. The schema lives in `packages/db` (Drizzle); Go reads it through sqlc |
| **Redis 7**               | Endpoint cache, rate-limit buckets, live fan-out, tunnel routing. Never the system of record                             |
| **S3-compatible storage** | Request bodies over 64 KiB                                                                                               |

All hosts and ports come from the environment (`APP_URL`, `EDGE_PUBLIC_URL`, ...); none are hard-coded.

## Request lifecycle

What happens when a sender calls `ANY /h/{slug}[/*]` (`services/edge/internal/intake`):

1. **Request ID.** Middleware assigns a UUIDv7, returns it as `X-Hookline-Request-Id`, and the same value becomes the request's primary key.
2. **CORS preflight** (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is answered with `204` and not captured. Every other method, `HEAD` and `OPTIONS` included, is captured.
3. **Resolve the endpoint.** The slug must be 12 base62 characters before anything is looked up. The endpoint comes from Redis (`hl:ep:{slug}`, 60 s) or PostgreSQL; unknown slugs are cached as misses for 10 s. The web app deletes the key when settings change.
4. **Status.** Unknown slug → `404 not_found`. Paused → `410 endpoint_paused`. Disabled by an administrator → `410 endpoint_disabled`. Expired anonymous endpoint → `410 endpoint_expired`.
5. **Rate limit.** One Redis Lua script checks two token buckets, the endpoint's (rate and burst from the owner's plan) and the source IP's (instance-wide), taking a token only when both allow. Server time (`TIME`) keeps instances consistent. Rejections get `429 rate_limited` with `Retry-After`.
6. **Quota.** Anonymous endpoints accept at most 100 requests (`429 quota_exceeded`). Monthly quotas for organizations arrive with usage tracking.
7. **Body.** The plan's cap is enforced from `Content-Length` and again while streaming (`http.MaxBytesReader`) → `413 body_too_large`. Bodies up to 64 KiB are stored inline; larger ones are uploaded to object storage first under `{org|anonymous}/{endpoint}/{yyyy}/{mm}/{dd}/{requestId}`.
8. **Insert.** One row in the partitioned `request` table. If the day's partition is missing, the edge creates it (`hookline_ensure_request_partitions`) and retries once.
9. **Announce.** A request summary (no header values, no body) is published on `ep:{endpointId}`. Endpoint counters are batched in memory and flushed every second rather than updated per request, which would serialize intake on a row lock.
10. **Respond** with the endpoint's configured status, headers and body after its optional delay.

### Response hardening

Intake responses are served from the application's own origin, and their content is chosen by whoever configures the endpoint. Every intake response therefore carries:

- `Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'none'`: any HTML runs in an opaque, script-less origin and can never act as the dashboard.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- `Access-Control-Allow-Origin: *` (intake only), exposing `X-Hookline-Request-Id`.

Configured responses cannot set cookies, security policies, CORS, framing, hop-by-hop or `X-Hookline-*` headers.

### Header fidelity

Headers are stored as an ordered array of `[name, value]` pairs, with repeated values kept in their original order. Go's HTTP server canonicalizes header names and does not preserve their order, HTTP/2 lowercases them, and any proxy in front (Caddy) rebuilds them. So the edge stores names in canonical form, sorted, with `Host` first. Original casing and inter-header order are not recoverable once a request has passed through a standard HTTP stack.

## Data model notes

- **IDs** are UUIDv7 everywhere, from a `uuidv7()` SQL default (PostgreSQL 17 has none built in) or from the application when the timestamp must be chosen.
- **`request` is partitioned by day** on `received_at` (UTC), with primary key `(id, received_at)`. The worker keeps partitions 7 days ahead, and retention drops whole partitions. `delivery` references requests by `(request_id, request_received_at)` without a foreign key, so dropping a partition is never blocked.
- **Search** uses a trigram GIN index on `encode(body_inline, 'escape')`, which is immutable and never fails on invalid UTF-8. Queries escape the term the same way.
- **`updated_at`** is maintained by triggers, so Go and TypeScript writers behave identically.

## Failure behaviour

| Failure             | Effect                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis down          | Intake keeps working: endpoints load from PostgreSQL, rate limiting fails open, live updates and tunnels degrade. Logged once per 10 s and counted in `hookline_edge_degraded_operations_total`. `/readyz` reports `degraded` with status 200 |
| Object storage down | Bodies over 64 KiB get `503 storage_unavailable`; smaller ones are still captured                                                                                                                                                             |
| PostgreSQL down     | Intake answers `503 unavailable`; `/readyz` answers 503 so the instance leaves rotation                                                                                                                                                       |
| Worker down         | Jobs wait in PostgreSQL; nothing is lost                                                                                                                                                                                                      |
| Shutdown            | Servers stop accepting, drain in-flight requests (`EDGE_SHUTDOWN_TIMEOUT`, default 25 s) and flush endpoint counters                                                                                                                          |

## Observability

- **Logs:** structured JSON (`slog`), one access-log line per request with the request ID, method, path, status, size and duration. Query strings, header values and bodies are never logged.
- **Metrics** (`EDGE_METRICS_ADDR`, default `:9090`): `hookline_intake_duration_seconds{outcome}`, `hookline_intake_body_bytes_total`, `hookline_intake_rejects_total{reason}`, `hookline_intake_offloaded_bodies_total`, `hookline_edge_degraded_operations_total{dependency,operation}`, plus Go runtime and process metrics.

## Development environment

- `docker compose up -d` provides PostgreSQL, Redis, MinIO (with the bucket created) and Mailpit on 127.0.0.1.
- One root `.env` configures everything. `scripts/go.ts dev` passes it to the Go services. `scripts/with-env.ts` starts Next.js with it, because Next.js only reads `.env` files from its own directory and resets `process.env` before rendering.
- In development the web app (`:3000`) and the edge (`:8080`) are separate origins; `EDGE_PUBLIC_URL` tells the web app where intake lives. In production Caddy serves both from one domain.
- The web app derives client addresses from the rightmost `X-Forwarded-For` hop, which Caddy sets. It must not be exposed without the proxy.
