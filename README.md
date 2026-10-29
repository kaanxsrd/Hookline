# Hookline

**Catch every webhook. Replay anything. Pipe it to localhost.**

Hookline gives developers a URL that captures any HTTP request, shows it live, lets them inspect, replay and forward it, and pipes it to localhost through a CLI tunnel.

> Hookline is under active development. See [`docs/implementation-status.md`](docs/implementation-status.md) for what works today.

## Quick start

Requirements: [Bun](https://bun.sh) 1.3+, [Go](https://go.dev/dl/) 1.27+ and Docker.

```sh
cp .env.example .env
docker compose up -d     # Postgres, Redis, MinIO (+ bucket), Mailpit
bun install
bun run db:migrate
bun run db:seed          # demo org; sign in as admin@hookline.local / hookline-dev-password
bun run dev              # web :3000, edge :8080, worker :8081
```

The first `bun run dev` or `bun run check` also builds the pinned Go tools (air, golangci-lint) into `.tools/bin`, which takes a minute or two.

| URL                           | What                  |
| ----------------------------- | --------------------- |
| http://localhost:3000         | Web app               |
| http://localhost:8080/healthz | Edge server           |
| http://localhost:8081/healthz | Worker                |
| http://localhost:8025         | Mailpit (local email) |
| http://localhost:9001         | MinIO console         |

## Scripts

| Command               | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `bun run dev`         | Runs every service with hot reload (Next.js and air) |
| `bun run check`       | Biome, tsc, golangci-lint and all tests              |
| `bun run build`       | Production build                                     |
| `bun run check:fix`   | Applies Biome fixes                                  |
| `bun run db:migrate`  | Applies database migrations                          |
| `bun run db:seed`     | Loads demo data (safe to re-run)                     |
| `bun run db:generate` | Generates a migration from schema changes            |
| `bun run db:studio`   | Opens Drizzle Studio                                 |
| `bun run admin:grant` | Makes an account an instance administrator           |
| `bun run gen`         | Regenerates entitlements and sqlc code               |

## Repository layout

```
apps/web           Next.js: marketing, docs, auth, dashboard, public REST API
services/edge      Go: webhook intake, SSE streams, CLI tunnels
services/worker    Go: forwarding, retries, retention, rollups
cli                Go: the hookline CLI
packages/db        Drizzle schema, migrations and seed (the only owner of the schema)
packages/gocommon  Go: config, logging, HTTP plumbing, sqlc queries shared by the Go services
packages/shared    TypeScript: entitlements and helpers shared across packages
config/plans.json  Plan limits (source of the generated Go and TypeScript entitlements)
tools              Pinned Go developer tools (outside go.work)
scripts            Repository scripts (Bun)
docs               Architecture, protocol, threat model and status docs
```

## License

[MIT](LICENSE)
