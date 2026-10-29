# Implementation status

Tracks every feature in the build spec. Updated at the end of each milestone.

Legend: ✅ done · 🚧 partially done (see note) · ⬜ not started

## Milestones

| #   | Milestone                        | Status |
| --- | -------------------------------- | ------ |
| 1   | Scaffold                         | ✅     |
| 2   | Database                         | ⬜     |
| 3   | Intake                           | ⬜     |
| 4   | Live stream                      | ⬜     |
| 5   | Auth & orgs                      | ⬜     |
| 6   | Inbox                            | ⬜     |
| 7   | Destinations & worker            | ⬜     |
| 8   | CLI & tunnel                     | ⬜     |
| 9   | Replay, verification & responses | ⬜     |
| 10  | Public API & keys                | ⬜     |
| 11  | Plans, usage & billing           | ⬜     |
| 12  | Marketing, docs & admin          | ⬜     |
| 13  | Hardening & release              | ⬜     |
| 14  | README                           | ⬜     |

## 1. Scaffold

| Feature                                                            | Status | Notes                                                                                                                                               |
| ------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun workspaces + Turborepo                                         | ✅     | Go modules have a `package.json` so Turborepo runs their `dev`, `lint` and `test` tasks too                                                         |
| `go.work` tying Go modules together                                | ✅     | `cli`, `packages/gocommon`, `services/edge`, `services/worker`                                                                                      |
| Pinned Go tools (air, golangci-lint)                               | ✅     | `tools/go.mod` `tool` directives, kept outside `go.work`; `scripts/go.ts` installs them into `.tools/bin` on first use                              |
| Biome (lint + format)                                              | ✅     | `biome.json`                                                                                                                                        |
| golangci-lint v2                                                   | ✅     | `.golangci.yml`                                                                                                                                     |
| docker-compose: Postgres 17, Redis 7, MinIO + bucket init, Mailpit | ✅     | MinIO uses Chainguard's source-built image because `minio/minio` is no longer published; ports bind to 127.0.0.1 and default away from 5432/6379    |
| `.env.example` + single root `.env`                                | ✅     | Loaded by Next.js (`next.config.ts`), the Go services (`scripts/go.ts dev`) and Compose                                                             |
| `bun run dev` boots every service                                  | ✅     | Next.js on :3000, edge on :8080 and worker on :8081 with air hot reload (watches `packages/gocommon` too)                                           |
| Edge `/healthz`                                                    | ✅     | chi router, request IDs (UUIDv7, `X-Hookline-Request-Id`), access log without query strings, panic recovery, JSON errors, graceful shutdown         |
| Worker `/healthz`                                                  | ✅     | Internal health listener; River jobs arrive in milestone 7                                                                                          |
| CLI skeleton                                                       | ✅     | Cobra root, `--json`, `version` with ldflags build info                                                                                             |
| Next.js 16 app                                                     | ✅     | App Router, Tailwind CSS 4 with shadcn-compatible tokens, Geist fonts, dark-first theme toggle, security headers, standalone output, `/api/healthz` |
| CI workflow                                                        | ✅     | `.github/workflows/ci.yml`: `bun run check` (Go tests with `-race`) and `bun run build` on every PR                                                 |
| `bun run check`                                                    | ✅     | Biome, tsc, `bun test scripts`, Turborepo `typecheck lint test`                                                                                     |
| Root scripts `db:*`, `gen`                                         | ✅     | Added in milestone 2                                                                                                                                |
| Root scripts `test:e2e`, `loadtest`                                | ⬜     | Added by milestones 4 and 13                                                                                                                        |
| Strict CSP                                                         | ⬜     | Needs per-request nonces in the Next.js proxy; milestone 5. Other security headers are set now                                                      |
| Local `go test -race` on Windows                                   | 🚧     | `-race` needs cgo and a C compiler; `scripts/go.ts` adds it whenever one is available and warns otherwise. CI always runs with `-race`              |

## 2. Database

| Feature                                    | Status | Notes                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle schema for every table in the spec | ✅     | `packages/db/src/schema`: Better Auth tables (+ `user.is_admin`, `user.disabled_at`), endpoint, request, destination, delivery, delivery_attempt, api_key, cli_device_code, audit_log, usage_daily, subscription, idempotency_key                                     |
| UUIDv7 IDs                                 | ✅     | `uuidv7()` SQL function (PG17 has none) as the default for every `id`; `uuidv7(at)` in TypeScript for backfilled rows                                                                                                                                                 |
| `created_at` / `updated_at`                | ✅     | `updated_at` kept current by a trigger, so Go and TypeScript writers behave the same. `request` uses `received_at` as its creation time; `endpoint`'s trigger ignores counter updates                                                                                 |
| `request` partitioned by day               | ✅     | `PARTITION BY RANGE (received_at)`, PK `(id, received_at)`; `hookline_ensure_request_partitions(from, to)` and `hookline_drop_request_partitions_before(day)`; migration creates yesterday through 7 days ahead                                                       |
| Request indexes                            | ✅     | `(endpoint_id, received_at DESC, id DESC)`; trigram GIN on `encode(body_inline, 'escape')`, which never fails on invalid UTF-8                                                                                                                                        |
| Constraints                                | ✅     | Slug format, anonymous endpoints must expire, response/sync/retention bounds, signature provider needs a secret, http(s)-only destinations, API key scope allow-list, device user-code format, member roles                                                           |
| Delivery ↔ request link                    | ✅     | `(request_id, request_received_at)` without a foreign key, so dropping a day partition is never blocked; retention deletes deliveries explicitly (milestone 7)                                                                                                        |
| River job tables                           | ✅     | River v0.50.0 schema in migration 0003 (Drizzle owns all migrations)                                                                                                                                                                                                  |
| Hand-written SQL migrations                | ✅     | 0000 (extensions, functions), 0002 (partitions, trigram index, triggers), 0003 (River); 0001 is generated, with one marked edit adding `PARTITION BY`                                                                                                                 |
| sqlc                                       | ✅     | `packages/gocommon/sqlc.yaml` reads `packages/db/migrations`; generated `dbq` package with uuid/time/netip/json overrides. Runs in Docker (`bun run gen`) because sqlc's parser needs cgo                                                                             |
| Initial Go queries                         | ✅     | Endpoint lookup for intake, request insert, partition ensure/drop, enabled destinations, API key lookup + throttled touch                                                                                                                                             |
| Go DB pool (`gocommon/db`)                 | ✅     | pgx pool with UTC session time zone; errors never echo the connection string                                                                                                                                                                                          |
| Go DB tests (`gocommon/dbtest`)            | ✅     | testcontainers PostgreSQL per test binary, migrated template database, a fresh clone per test; `TEST_DATABASE_URL` reuses an existing server                                                                                                                          |
| Seed                                       | ✅     | Admin + member, demo org (Pro), 4 endpoints with 82 realistic Stripe/GitHub/Shopify/generic requests (real HMAC signatures with demo secrets), destinations, 54 deliveries with attempt history, usage rows, audit entries. Idempotent; refuses `NODE_ENV=production` |
| Migrations from scratch, seed idempotency  | ✅     | `packages/db/src/db.test.ts` migrates a throwaway database, seeds twice and compares every table count                                                                                                                                                                |
| Drift checks in CI                         | ✅     | CI regenerates sqlc output and the Drizzle snapshot and fails on any difference                                                                                                                                                                                       |

## 3–14

Not started. Each section is filled in as its milestone lands.
