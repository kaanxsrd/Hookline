# Contributing

Thanks for helping improve Hookline. This guide covers the local setup and the conventions the codebase follows.

## Setup

Follow the [quick start](README.md#quick-start). You need Bun 1.3+, Go 1.27+ and Docker.

## How the monorepo fits together

- **Bun workspaces + Turborepo** drive everything. Each Go module (`cli`, `services/*`, `packages/gocommon`) has a small `package.json` so `turbo run dev | lint | test` covers Go and TypeScript alike.
- **`scripts/go.ts`** is the bridge: it runs air (`dev`), golangci-lint (`lint`) and `go test` (`test`). It adds `-race` whenever cgo has a C compiler; CI always does.
- **Go tools are pinned** with `tool` directives in `tools/go.mod`. That module sits outside `go.work` so tool dependencies never change the services' build lists. Tools are installed into `.tools/bin` on first use and reinstalled automatically when `tools/go.sum` or the Go version changes. To add one: `cd tools && GOWORK=off go get -tool <module>/cmd/<name>@<version>`.
- **One `.env` at the root** configures every service in development. Next.js loads it in `next.config.ts`; `scripts/go.ts dev` passes it to the Go services. Real environment variables always win.

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
