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
| Root scripts `db:*`, `gen`, `test:e2e`, `loadtest`                 | ⬜     | Added by the milestones that introduce them (2, 2, 4, 13)                                                                                           |
| Strict CSP                                                         | ⬜     | Needs per-request nonces in the Next.js proxy; milestone 5. Other security headers are set now                                                      |
| Local `go test -race` on Windows                                   | 🚧     | `-race` needs cgo and a C compiler; `scripts/go.ts` adds it whenever one is available and warns otherwise. CI always runs with `-race`              |

## 2–14

Not started. Each section is filled in as its milestone lands.
