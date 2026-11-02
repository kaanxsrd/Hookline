# syntax=docker/dockerfile:1
#
# Production images, one target per process:
#
#   docker build --target web     -t hookline-web .
#   docker build --target edge    -t hookline-edge .
#   docker build --target worker  -t hookline-worker .
#   docker build --target migrate -t hookline-migrate .
#
# Hosts that cannot pick a target (Railway) set the HOOKLINE_TARGET build
# argument instead: the last stage re-exports that target. There are no
# BuildKit cache mounts because Railway rejects mounts without its cache IDs.
#
# Every image runs as a non-root user and takes its configuration from the
# environment (see deploy/production.env.example).

ARG BUN_VERSION=1.4.2
ARG GO_VERSION=1.27.3
ARG NODE_VERSION=24.22.2
ARG HOOKLINE_TARGET=web

# ---------------------------------------------------------------- JavaScript

FROM oven/bun:${BUN_VERSION}-slim AS js-deps
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile

FROM js-deps AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --cwd apps/web build

# Next.js standalone output: server.js plus only the files it traces.
FROM node:${NODE_VERSION}-alpine AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=web-build --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /src/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]

# Applies database migrations, then exits. Also runs one-off scripts:
#   docker compose run --rm migrate bun packages/db/scripts/admin-grant.ts you@example.com
FROM oven/bun:${BUN_VERSION}-slim AS migrate
WORKDIR /app
COPY --from=js-deps /src/package.json /src/bun.lock ./
COPY --from=js-deps /src/node_modules ./node_modules
COPY --from=js-deps /src/packages/db ./packages/db
USER bun
CMD ["bun", "packages/db/scripts/migrate.ts"]

# ---------------------------------------------------------------------- Go

FROM golang:${GO_VERSION}-alpine AS go-build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
COPY go.work go.work.sum ./
COPY cli/go.mod cli/go.sum cli/
COPY packages/gocommon/go.mod packages/gocommon/go.sum packages/gocommon/
COPY packages/protocol/go.mod packages/protocol/go.sum packages/protocol/
COPY services/edge/go.mod services/edge/go.sum services/edge/
COPY services/worker/go.mod services/worker/go.sum services/worker/
RUN go mod download
COPY cli cli
COPY packages/gocommon packages/gocommon
COPY packages/protocol packages/protocol
COPY services services
RUN go build -ldflags="-s -w" -o /out/edge ./services/edge && \
    go build -ldflags="-s -w" -o /out/worker ./services/worker

# Distroless: no shell, no package manager, CA certificates and tzdata only.
FROM gcr.io/distroless/static-debian12:nonroot AS edge
COPY --from=go-build /out/edge /usr/local/bin/edge
ENV EDGE_ADDR=:8080 EDGE_METRICS_ADDR=:9090 LOG_FORMAT=json
EXPOSE 8080 9090
ENTRYPOINT ["/usr/local/bin/edge"]

FROM gcr.io/distroless/static-debian12:nonroot AS worker
COPY --from=go-build /out/worker /usr/local/bin/worker
ENV WORKER_HEALTH_ADDR=:8081 LOG_FORMAT=json
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/worker"]

# ------------------------------------------------------------------ Default

# `docker build .` without --target builds HOOKLINE_TARGET (web by default).
FROM ${HOOKLINE_TARGET}
