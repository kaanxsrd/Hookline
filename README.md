<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://hookline.vante.app/readme/banner-dark.webp">
  <img alt="Hookline: Catch every webhook. Replay anything." src="https://hookline.vante.app/readme/banner-light.webp" width="100%">
</picture>

<br>

**A webhook URL that captures every request, shows it live, replays it anywhere and pipes it to `localhost` through a CLI tunnel.**

<br>

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Go 1.27](https://img.shields.io/badge/Go-1.27-00add8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.sh)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-4169e1?style=flat-square&logo=postgresql&logoColor=white)](https://orm.drizzle.team)
[![Redis](https://img.shields.io/badge/Redis-pub%2Fsub-dc382d?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4-06b6d4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
<br>
[![npm](https://img.shields.io/npm/v/hookline-cli?style=flat-square&label=hookline-cli&color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/hookline-cli)
[![Homebrew](https://img.shields.io/badge/Homebrew-kaanxsrd%2Ftap-fbb040?style=flat-square&logo=homebrew&logoColor=black)](https://github.com/kaanxsrd/homebrew-tap)
[![Scoop](https://img.shields.io/badge/Scoop-hookline-4a90d9?style=flat-square&logo=windows&logoColor=white)](https://github.com/kaanxsrd/scoop-bucket)
[![Docker](https://img.shields.io/badge/images-GHCR-2496ed?style=flat-square&logo=docker&logoColor=white)](docs/deployment.md)
[![OpenAPI](https://img.shields.io/badge/API-OpenAPI_3.0-6ba539?style=flat-square&logo=openapiinitiative&logoColor=white)](api/openapi.yaml)
[![Playwright](https://img.shields.io/badge/E2E-Playwright-2ead33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-8b7cf6?style=flat-square)](LICENSE)

**[Website](https://hookline.vante.app)** ·
**[Docs](https://hookline.vante.app/docs)** ·
**[CLI](https://hookline.vante.app/docs/cli)** ·
**[API](https://hookline.vante.app/docs/api)** ·
**[Changelog](CHANGELOG.md)** ·
**[Self-hosting](docs/deployment.md)** ·
**[Security](SECURITY.md)**

</div>

<br>

<img alt="The Hookline home page: 'Catch every webhook. Replay anything. Pipe it to localhost.' above a live terminal" src="https://hookline.vante.app/readme/screenshot-home.webp" width="100%">

<table>
  <tr>
    <td width="50%"><img alt="The live inbox: a list of captured Stripe webhooks next to the selected request's JSON body" src="https://hookline.vante.app/readme/screenshot-inbox.webp"></td>
    <td width="50%"><img alt="The dashboard: a getting-started checklist, request metrics and the endpoint list" src="https://hookline.vante.app/readme/screenshot-dashboard.webp"></td>
  </tr>
  <tr>
    <td align="center"><sub>Every request, live: body, headers, signature and deliveries.</sub></td>
    <td align="center"><sub>Your endpoints, traffic and plan at a glance.</sub></td>
  </tr>
</table>

## ✨ Features

<table>
  <tr>
    <td width="50%" valign="top">

**📥 Capture everything**<br>
Every method on any sub-path, with headers, query, body, source and timing. Custom responses and delays, and temporary endpoints that need no account.

</td>
    <td width="50%" valign="top">

**⚡ A live inbox**<br>
Requests appear in about 100 ms and the stream picks up where it left off after a disconnect. Filters, full-text search, keyboard shortcuts, and JSON, form, XML, raw and hex views.

</td>
  </tr>
  <tr>
    <td valign="top">

**🔁 Replay anything**<br>
Send any request again to a destination, to the CLI or to any URL, exactly as captured or after editing it.

</td>
    <td valign="top">

**💻 Tunnel to localhost**<br>
`hookline listen` forwards webhooks to your machine. Sync mode returns your server's answer to the sender.

</td>
  </tr>
  <tr>
    <td valign="top">

**🛡️ Verify signatures**<br>
Stripe, GitHub, Shopify, Slack, Discord, Standard Webhooks and generic HMAC-SHA256, checked the moment a request lands. Sensitive headers stay masked until revealed, and every reveal is audited.

</td>
    <td valign="top">

**📤 Forward reliably**<br>
Destinations with method, header and JSON-path filters, durable retries with backoff, a full attempt log and optional Standard Webhooks signing. Forwarding never reaches private networks.

</td>
  </tr>
  <tr>
    <td valign="top">

**👥 Built for teams**<br>
Organizations with viewer, member, admin and owner roles, invitations, an audit log, passkeys and TOTP.

</td>
    <td valign="top">

**🧩 Built for developers**<br>
A REST API described by [OpenAPI](api/openapi.yaml), with scoped keys, idempotency keys and rate limits, plus a native CLI for macOS, Linux and Windows.

</td>
  </tr>
</table>

Plans with usage limits, optional Stripe billing, a status page and an admin area come built in. Self-hosted instances can lift every limit.

## 🚀 Quick start

Use the hosted service at **[hookline.vante.app](https://hookline.vante.app)**: get a webhook URL in one click, no account needed. Then forward it to your machine:

```sh
npm install -g hookline-cli
hookline login
hookline listen k3Jx9QpL2mWa --forward http://localhost:3000/api/webhooks
```

```text
✓ Forwarding https://hooks.vante.app/h/k3Jx9QpL2mWa → http://localhost:3000/api/webhooks
12:04:31  POST /h/k3Jx9QpL2mWa/stripe  → 200   38 ms  payment_intent.succeeded
12:05:02  POST /h/k3Jx9QpL2mWa/github  → 500  112 ms  push
```

## 💻 Install the CLI

| Platform                         | Command                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| **npm** (any platform, Node 18+) | `npm install -g hookline-cli`                                                                      |
| **macOS** (Homebrew)             | `brew install --cask kaanxsrd/tap/hookline`                                                        |
| **Windows** (Scoop)              | `scoop bucket add hookline https://github.com/kaanxsrd/scoop-bucket` then `scoop install hookline` |

Release archives for macOS, Linux and Windows (x64 and arm64) come with checksums. The [CLI guide](https://hookline.vante.app/docs/cli) covers `listen`, `tail`, `replay`, `trigger`, `endpoints` and `update`.

## 🧭 How it works

```mermaid
flowchart LR
  sender([Webhook sender]) -->|/h/slug| caddy{{Caddy}}
  cli([hookline CLI]) -->|/v1/tunnel| caddy
  browser([Dashboard]) --> caddy
  caddy -->|/h/*, /v1/*| edge[Edge · Go]
  caddy -->|everything else| web[Web · Next.js]
  edge --> pg[(PostgreSQL)]
  edge --> redis[(Redis)]
  edge --> s3[(S3)]
  web --> pg
  worker[Worker · Go] --> pg
  worker -->|forward| dest([Destinations])
```

- The **edge** (Go) captures requests, streams them to open inboxes and runs CLI tunnels.
- The **worker** (Go) forwards, retries, replays and enforces retention.
- The **web app** (Next.js) serves the dashboard, docs and REST API.
- **PostgreSQL** holds everything durable, including the job queue. **Redis** is a cache and pub/sub bus the edge can run without. Large bodies go to **S3-compatible** storage.

More in [architecture](docs/architecture.md) and the [tunnel protocol](docs/tunnel-protocol.md).

## 🏠 Self-host

On a host with Docker, ports 80 and 443 open and a DNS record pointing at it:

```sh
git clone https://github.com/kaanxsrd/Hookline && cd Hookline
cp deploy/production.env.example .env.production   # domain, secrets, email
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

That starts Caddy with automatic TLS, the web app, the edge, the worker, PostgreSQL, Redis, MinIO and daily backups, and runs migrations first. The [deployment guide](docs/deployment.md) covers the first administrator, backups and restores, upgrades, Railway, Fly.io, email and Stripe.

## 🛠️ Develop

Requires [Bun](https://bun.sh) 1.3+, [Go](https://go.dev/dl/) 1.27+ and Docker.

```sh
cp .env.example .env
docker compose up -d     # PostgreSQL, Redis, MinIO and Mailpit
bun install
bun run db:migrate
bun run db:seed          # demo org: admin@hookline.local / hookline-dev-password
bun run dev              # web :3000, edge :8080, worker :8081
```

The first `bun run dev` or `bun run check` builds the pinned Go tools (air, golangci-lint, govulncheck) into `.tools/bin`, which takes a minute or two. The seeded admin can open `/admin`.

<details>
<summary><b>Local URLs</b></summary>

<br>

| URL                           | What                  |
| ----------------------------- | --------------------- |
| http://localhost:3000         | Web app               |
| http://localhost:8080/healthz | Edge                  |
| http://localhost:8081/healthz | Worker                |
| http://localhost:8025         | Mailpit (local email) |
| http://localhost:9001         | MinIO console         |

</details>

<details>
<summary><b>Scripts</b></summary>

<br>

| Command               | What it does                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `bun run dev`         | Runs every service with hot reload (Next.js and air)              |
| `bun run check`       | Biome, tsc, golangci-lint and all unit tests                      |
| `bun run test:e2e`    | Playwright end-to-end tests against the local stack               |
| `bun run build`       | Production build                                                  |
| `bun run check:fix`   | Applies Biome fixes                                               |
| `bun run db:migrate`  | Applies database migrations                                       |
| `bun run db:seed`     | Loads demo data (safe to re-run)                                  |
| `bun run db:generate` | Generates a migration from schema changes                         |
| `bun run db:studio`   | Opens Drizzle Studio                                              |
| `bun run gen`         | Regenerates API types, entitlements, mail templates and sqlc code |
| `bun run admin:grant` | Makes an account an instance administrator                        |
| `bun run loadtest`    | Load-tests an intake URL and reports latency percentiles          |
| `bun run vulncheck`   | govulncheck on every Go module and `bun audit`                    |

</details>

<details>
<summary><b>Repository layout</b></summary>

<br>

```text
apps/web           Next.js: marketing site, docs, auth, dashboard, admin, REST API
services/edge      Go: webhook intake, live streams, CLI tunnels
services/worker    Go: forwarding, retries, retention, rollups, notifications
cli                Go: the hookline CLI (cli/npm: the npm launcher)
packages/db        Drizzle schema, migrations and seed (the only owner of the schema)
packages/gocommon  Go: config, logging, HTTP plumbing and sqlc queries for the Go services
packages/protocol  Go: the CLI tunnel protocol
packages/shared    TypeScript: API types, entitlements and shared helpers
api/openapi.yaml   The REST API contract
config/plans.json  Plan limits (source of the generated Go and TypeScript entitlements)
deploy             Caddyfile, production env template, Fly.io and Railway configurations
scripts            Bun scripts: code generation, load testing, release packaging
docs               Architecture, tunnel protocol and deployment
```

</details>

## 📚 Documentation

| Guide                                                | What's inside                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| [Docs](https://hookline.vante.app/docs)              | Endpoints, the inbox, replay, destinations, signatures, plans       |
| [CLI guide](https://hookline.vante.app/docs/cli)     | Install, log in, tunnels and every command                          |
| [API reference](https://hookline.vante.app/docs/api) | The REST API, generated from [`api/openapi.yaml`](api/openapi.yaml) |
| [Architecture](docs/architecture.md)                 | Services, data model and design decisions                           |
| [Tunnel protocol](docs/tunnel-protocol.md)           | How the CLI and the edge talk                                       |
| [Deployment](docs/deployment.md)                     | Self-hosting, backups, upgrades and releases                        |
| [Changelog](CHANGELOG.md)                            | What changed in each version                                        |
| [Contributing](CONTRIBUTING.md)                      | Conventions, database changes, tests and releases                   |
| [Security policy](SECURITY.md)                       | How to report a vulnerability                                       |

## 📄 License

[GNU General Public License v3.0](LICENSE) © Vante. Hookline is free software: you can redistribute and modify it under the terms of the GPL, version 3. It comes with no warranty.

<div align="center">
<br>
<sub>Built for everyone who has ever waited on a webhook. 🪝</sub>
</div>
