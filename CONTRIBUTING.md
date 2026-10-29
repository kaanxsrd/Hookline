# Contributing

Thanks for helping improve Hookline. This guide covers the local setup and the conventions the codebase follows.

## Setup

Follow the [quick start](README.md#quick-start). You need Bun 1.3+, Go 1.27+ and Docker.

## How the monorepo fits together

- **Bun workspaces + Turborepo** drive everything. Each Go module (`cli`, `services/*`, `packages/gocommon`, `packages/protocol`) has a small `package.json` so `turbo run dev | lint | test` covers Go and TypeScript alike. Go modules depend on each other through `replace` directives Turborepo cannot see, so `turbo.json` lists the shared Go sources (and the signature test vectors in `packages/shared/fixtures`) as inputs of `lint` and `test`.
- **`scripts/go.ts`** is the bridge: it runs air (`dev`), golangci-lint (`lint`) and `go test` (`test`). It adds `-race` whenever cgo has a C compiler; CI always does.
- **Go tools are pinned** with `tool` directives in `tools/go.mod`. That module sits outside `go.work` so tool dependencies never change the services' build lists. Tools are installed into `.tools/bin` on first use and reinstalled automatically when `tools/go.sum` or the Go version changes. To add one: `cd tools && GOWORK=off go get -tool <module>/cmd/<name>@<version>`.
- **One `.env` at the root** configures every service in development. Next.js loads it in `next.config.ts`; `scripts/go.ts dev` passes it to the Go services. Real environment variables always win.

## Database changes

`packages/db` owns the schema. Go never writes migrations; sqlc reads the same SQL files.

1. Edit the Drizzle schema in `packages/db/src/schema`.
2. `bun run db:generate` writes a new migration in `packages/db/migrations`. For anything Drizzle cannot express (functions, triggers, partitioning, extensions), create an empty one with `cd packages/db && bun --bun drizzle-kit generate --custom --name=<what>` and write the SQL by hand.
3. `bun run db:migrate` applies it locally.
4. If Go needs new queries, add them to `packages/gocommon/dbq/queries/*.sql` and run `bun run gen` (sqlc runs in Docker).
5. Commit the schema, the migration, the `meta/` snapshot and the generated Go code together. CI fails if any of them drift.

Tables with an `updated_at` column need a `hookline_set_updated_at` trigger in the same migration. The `request` table is partitioned by day: a migration that recreates it must keep `PARTITION BY RANGE (received_at)`.

Database tests need Docker. TypeScript tests create a throwaway database on the server in `DATABASE_URL` (the compose Postgres by default). Go tests start PostgreSQL with testcontainers, or use the server in `TEST_DATABASE_URL` when set; packages that use `dbtest` need `func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }`.

## End-to-end tests

```sh
docker compose up -d && bun run db:migrate
bun run test:e2e
```

Playwright starts the edge and the web app, or reuses the ones `bun run dev` already runs. Tests read emails from Mailpit, so the compose stack must be up. CI runs the same suite against the production build.

## Before you open a pull request

```sh
bun run check
```

This must pass: Biome, tsc, golangci-lint, Go tests and Vitest. CI runs the same command plus a production build.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org): `feat(edge): ...`, `fix(web): ...`, `docs: ...`.
- **Go:** standard library style, `context` everywhere, `log/slog`, no global state, errors wrapped with `%w`. Tests use `testing` and `testify`.
- **TypeScript:** strict mode, no `any`. Format and lint with Biome.
- **Security:** never log request bodies, header values or secrets. Treat every byte from the internet as hostile.
- **Docs:** update `docs/implementation-status.md` when a feature lands.
