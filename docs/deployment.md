# Deployment

Configuration is entirely through environment variables. `.env.example` lists every one with development values, and `deploy/production.env.example` lists the production ones.

- [Production on one host](#production-on-one-host) with Docker Compose and Caddy
- [Backups and restores](#backups-and-restores)
- [Upgrades](#upgrades)
- [Fly.io](#flyio)
- [Railway](#railway) (and Vercel)
- [Releases](#releases)
- [Load testing](#load-testing)
- [Email](#email), [billing with Stripe](#billing-with-stripe) and [plan limits](#plan-limits)

## Production on one host

`docker-compose.prod.yml` runs a complete instance: Caddy (TLS from Let's Encrypt), the web app, the edge, the worker, PostgreSQL 17, Redis 7, MinIO and a daily backup job. You need a host with Docker, ports 80 and 443 open, and a DNS record for your domain pointing at it.

```sh
git clone https://github.com/kaanxsrd/hookline && cd hookline
cp deploy/production.env.example .env.production
# Fill in the domain, secrets (openssl rand -base64 48) and SMTP settings.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Every `up` first runs the `migrate` container, which applies pending migrations; the web app, edge and worker start only after it succeeds. Images come from `ghcr.io/kaanxsrd/hookline-{web,edge,worker,migrate}` at `HOOKLINE_VERSION`. To build them from the checkout instead, run `docker compose -f docker-compose.prod.yml --env-file .env.production build` first.

| Image     | Built from (`Dockerfile` target)          | Runs as                        |
| --------- | ----------------------------------------- | ------------------------------ |
| `web`     | Next.js standalone output on Node 24      | `node`, port 3000              |
| `edge`    | Static Go binary on distroless            | `nonroot`, ports 8080 and 9090 |
| `worker`  | Static Go binary on distroless            | `nonroot`, port 8081 (health)  |
| `migrate` | `packages/db` and its dependencies on Bun | `bun`, exits when done         |

**Routing.** `deploy/Caddyfile` sends `/h/*` and `/v1/*` to the edge, with flushing on and compression off so live streams and sync responses are not held back, and everything else to the web app. It adds HSTS and strips `Server`. Caddy replaces `X-Forwarded-For` with the client address it sees, which is what the web app and the edge rely on: never publish the web app or the edge ports directly.

**First administrator.** Sign up in the browser, then:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm migrate bun packages/db/scripts/admin-grant.ts you@example.com
```

**Private instances** usually set `PLAN_OVERRIDE=unlimited`. **Redis** runs without persistence: it only holds caches, rate-limit buckets and pub/sub, and the monthly quota counters are seeded again from PostgreSQL.

**Health.** `GET /api/healthz` (web, liveness), `GET /api/readyz` (web, database), `/readyz` on the edge (`ready`, `degraded` without Redis or object storage, `unavailable` without PostgreSQL) and on the worker's port 8081. `/status` shows the same in the browser. Prometheus metrics are on the edge's port 9090, inside the Docker network only.

## Backups and restores

The `backup` service writes `pg_dump --format=custom` dumps to the `backups` volume once a day and deletes those older than `BACKUP_KEEP_DAYS` (14 by default). Copy them off the host, for example with a nightly `rsync` or `restic` of the volume:

```sh
docker run --rm -v hookline-production_backups:/backups -v "$PWD":/out alpine \
  sh -c 'cp /backups/$(ls /backups | tail -1) /out/'
```

To restore, stop the services that write, restore into the empty database, then start everything again:

```sh
P="docker compose -f docker-compose.prod.yml --env-file .env.production"
$P stop web edge worker
$P exec -T postgres dropdb -U hookline hookline
$P exec -T postgres createdb -U hookline hookline
$P exec -T postgres pg_restore -U hookline -d hookline --no-owner < hookline-20261029T030000Z.dump
$P up -d
```

Request bodies over 64 KiB live in MinIO (`minio-data` volume), not in the dump. Back them up with `mc mirror` or by copying the volume. Without them, the requests they belong to are still listed but their large bodies cannot be shown, downloaded or forwarded. Keep `DATA_ENCRYPTION_KEY` with the backups: without it, signing secrets in the dump cannot be decrypted.

## Upgrades

Read the release notes, then set `HOOKLINE_VERSION` to the new version and run:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Migrations run before the new web app, edge and worker start, while the previous version is still serving, so migrations must stay compatible with the version before them (add columns before using them, drop them a release later). The edge and worker get 30 seconds to finish in-flight work; open streams and tunnels reconnect on their own.

## Fly.io

`deploy/fly/` has configurations for three Fly apps. The edge gets its own hostname (for example `hooks.example.com`), because Fly routes by host, not path. Use managed services for the stores: Fly Postgres or any PostgreSQL 17, Upstash Redis, and Tigris or any S3-compatible bucket.

```sh
fly apps create hookline-web && fly apps create hookline-edge && fly apps create hookline-worker
# Set the same secrets on all three apps:
fly secrets set --app hookline-web DATABASE_URL=... REDIS_URL=... BETTER_AUTH_SECRET=... \
  STREAM_TOKEN_SECRET=... DATA_ENCRYPTION_KEY=... S3_ENDPOINT=... S3_BUCKET=... \
  S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... SMTP_URL=... MAIL_FROM=... \
  APP_URL=https://hookline.example.com EDGE_PUBLIC_URL=https://hooks.example.com \
  EDGE_INTERNAL_URL=http://hookline-edge.internal:8080
# Apply migrations with a one-off machine, then deploy:
fly machine run ghcr.io/kaanxsrd/hookline-migrate:latest --app hookline-web --rm \
  --env DATABASE_URL=...
fly deploy --config deploy/fly/edge.toml
fly deploy --config deploy/fly/worker.toml
fly deploy --config deploy/fly/web.toml
fly certs add hookline.example.com --app hookline-web
fly certs add hooks.example.com --app hookline-edge
```

The web app sends HSTS itself when `APP_URL` is `https://`. The browser's live stream connects to the edge origin, which the Content Security Policy allows through `EDGE_PUBLIC_URL`.

## Railway

Everything can run in one Railway project, on Railway's private network: the web app, the edge, the worker, PostgreSQL and Redis. As with Fly.io, the edge gets its own hostname (for example `hooks.example.com`) because Railway routes by host, not path.

1. **Project and stores.** Create a project, then add **PostgreSQL** and **Redis** from Railway's templates, all in one region. Hookline's migrations run on PostgreSQL 17 and 18. Redis only holds caches, rate-limit buckets and pub/sub, so give it a cap and no persistence: in its start command, replace `--save 60 1` with `--save '' --appendonly no --maxmemory 64mb --maxmemory-policy allkeys-lru`.
2. **Services.** Add four empty services that build the root `Dockerfile`. Railway cannot pick a Dockerfile stage, so each one sets `HOOKLINE_TARGET`, which Railway passes to the build:

   | Service   | `HOOKLINE_TARGET` | Settings                                                                                 | Domain              |
   | --------- | ----------------- | ---------------------------------------------------------------------------------------- | ------------------- |
   | `web`     | `web`             | Healthcheck `/api/readyz`, restart on failure, `PORT=3000`                               | App domain → 3000   |
   | `edge`    | `edge`            | Healthcheck `/readyz`, restart on failure, draining 30 s, `EDGE_ADDR=:8080`, `PORT=8080` | Hooks domain → 8080 |
   | `worker`  | `worker`          | Restart on failure, draining 30 s                                                        | None                |
   | `migrate` | `migrate`         | Restart policy **never**: it applies migrations and exits                                | None                |

3. **Variables.** Every service except `migrate` gets `APP_URL`, `EDGE_PUBLIC_URL`, `DATA_ENCRYPTION_KEY`, `STREAM_TOKEN_SECRET`, the SMTP and S3 settings, `LOG_FORMAT=json` and `CLIENT_IP_HEADER=x-real-ip`. Each service uses the private URLs `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `REDIS_URL=${{Redis.REDIS_URL}}`; the web app adds `?family=0` to the Redis URL (so ioredis resolves Railway's IPv6 private addresses), `BETTER_AUTH_SECRET`, `DATABASE_POOL_MAX=5` and `EDGE_INTERNAL_URL=http://edge.railway.internal:8080`.
4. **Deploy** in this order: `migrate` (its logs end with "Migrations applied."), then the edge, the worker and the web app. Deploy the checkout by hand with `railway up --service <name>`; `.railwayignore` keeps `.env*` files out of the upload.
   **Automatic deploys:** `.github/workflows/deploy.yml` deploys `main` once CI has passed on it. It runs `migrate` first and checks it succeeded, then redeploys only the services whose sources changed since the commit tagged `deployed/production`, smoke-tests both domains and moves the tag. It needs one secret, `RAILWAY_TOKEN`: a project token for the production environment (Railway → project → Settings → Tokens). Run it by hand (Actions → Deploy → Run workflow, "Redeploy every service") after changing variables.
5. **Domains.** Add both custom domains and create the CNAME and `_railway-verify` TXT records Railway shows. `/status` should then report every component as operational.

**Client addresses.** Railway's proxy ends `X-Forwarded-For` with the public address of its own edge server and sets `X-Real-Ip` to the sender, replacing any value the sender sent. `CLIENT_IP_HEADER=x-real-ip` makes the edge and the web app use it for requests from trusted proxies; without it, every sender would share one per-IP rate-limit bucket and one sign-in limit.

**Keeping Railway cheap.** Railway bills for the CPU and memory services actually use, for volumes and for egress; builds and private networking are free.

- The Go services idle at a few tens of MB. `GOMEMLIMIT=96MiB` keeps them from growing, and `EDGE_DB_MAX_CONNS=8` and `WORKER_DELIVERY_CONCURRENCY=10` fit a small instance (raise them under real load).
- Never put the edge to sleep: webhook senders do not retry forever. `migrate` costs nothing between deploys because it exits.
- Keep every service in one region and use the private URLs; nothing needs Railway's public TCP proxies.
- Retention keeps the database small: the worker deletes requests past each endpoint's retention, and the Free plan keeps 24 hours.
- Put bodies over 64 KiB in Cloudflare R2 (no egress fees, free tier) instead of a bucket on Railway, or leave `S3_BUCKET` empty to reject them.

**The web app on Vercel instead.** Import the repository with Root Directory `apps/web`; `apps/web/vercel.json` pins functions to `fra1` and skips builds when only Go code changed. Enable Railway's TCP proxies on Postgres and Redis and use their public URLs (`?sslmode=require` on the database URL), `DATABASE_POOL_MAX=3`, `EDGE_INTERNAL_URL` set to the edge's public URL, and `CLIENT_IP_HEADER` unset (Vercel sets `X-Forwarded-For` to the client). Background emails use `after()`, so Vercel keeps a function alive until they are sent. Vercel's Hobby plan is for non-commercial use, and Redis traffic through Railway's TCP proxy is not encrypted.

**Email on Railway.** Railway blocks outbound SMTP below the Pro plan (connections to port 587 simply time out), so on Hobby send through [Resend](#resend) over HTTPS, or upgrade to Pro for SMTP.

## Releases

One version covers the whole product. Pushing a tag such as `v1.0.0` runs `.github/workflows/release.yml`:

- **CLI:** goreleaser (`.goreleaser.yaml`) builds macOS, Linux and Windows binaries for x64 and arm64, publishes archives and checksums on the GitHub release, and updates the Homebrew cask in `kaanxsrd/homebrew-tap` and the Scoop manifest in `kaanxsrd/scoop-bucket`. `scripts/release/npm.ts` turns the binaries into `hookline-cli`, a small launcher, plus one optional package per platform (no install script). Release builds talk to `vars.HOOKLINE_DEFAULT_URL` by default.
- **Images:** `web`, `edge`, `worker` and `migrate` for `linux/amd64` and `linux/arm64` go to GHCR, tagged with the version, `major.minor` and `latest` (not for pre-releases such as `v0.2.0-rc.1`), with provenance and an SBOM.

The tap, bucket and npm steps are skipped when their secrets (`HOMEBREW_TAP_TOKEN`, `SCOOP_BUCKET_TOKEN`, `NPM_TOKEN`) are not set. CI builds every image and a goreleaser snapshot on each push, so a release cannot break on packaging alone. Try it locally with `goreleaser release --snapshot --clean`.

## Load testing

```sh
bun run loadtest -- --url http://localhost:8080/h/<slug> --duration 30s --concurrency 64
```

The script reports throughput, latency percentiles and status counts, and exits 1 when more than `--max-failure-rate` (1 % by default) of requests fail. Plan limits apply as for any sender, so use an endpoint on an unlimited plan (`PLAN_OVERRIDE=unlimited` in development). The instance-wide per-IP limit (`config/plans.json`, 50 per second with bursts of 200) caps a single machine. When you call the edge directly from a loopback or private address, `--spread-ips` gives each request its own `X-Forwarded-For` so the test measures the edge rather than that limit. Through Caddy this has no effect, which is the point of the limit.

## Email

Set `SMTP_URL` (`smtp://user:pass@host:587` uses STARTTLS when offered, `smtps://user:pass@host:465` implicit TLS) and `MAIL_FROM`. The web app sends account emails (verification, password reset, invitations, plan changes); the worker sends operational notifications to each organization's owners and admins:

- **Deliveries failing:** when a delivery fails after its last attempt, at most once an hour per destination.
- **Usage:** when an organization passes 80 % and 100 % of its monthly requests, once each per month (checked after the hourly usage rollup).

Without `SMTP_URL` (or `RESEND_API_KEY`) the worker logs that notifications are disabled and skips them. The notification templates are React Email components in `apps/web/emails`; `bun run gen` renders them into Go templates (`packages/gocommon/mail/templates`), so both services send the same design.

Microsoft 365 over SMTP (`smtp.office365.com:587`) needs SMTP AUTH turned on for the mailbox; the URL is `smtp://user%40domain:password@smtp.office365.com:587` (the `@` in the user name becomes `%40`), and `MAIL_FROM` must be that mailbox or one it may send as. Both services support the `LOGIN` mechanism Microsoft 365 requires.

### Resend

Where outbound SMTP is blocked (Railway below Pro), the web app and the worker send through [Resend](https://resend.com)'s HTTPS API instead. Setting `RESEND_API_KEY` switches both services to Resend; `SMTP_URL` is then ignored. The free plan covers 3,000 emails a month (100 a day).

1. Create a Resend account and **Domains → Add domain** with the domain of `MAIL_FROM` (for example `vante.app`).
2. Add the DNS records Resend shows (an MX and TXT record on a `send` subdomain for bounces and SPF, and a DKIM TXT record) at your DNS provider, then **Verify**. They do not touch the domain's existing mailboxes.
3. **API keys → Create API key** with **Sending access** for that domain, and set it as `RESEND_API_KEY` on the web app and the worker.

Until the domain is verified, Resend refuses to send from it, and both services log "email delivery failed" with Resend's reason.

## Billing with Stripe

Billing is **off** unless `STRIPE_SECRET_KEY` is set. While it is off, the billing page says so and plans are changed by an instance administrator (the `plan_override` on an organization's subscription). Self-hosted instances usually set `PLAN_OVERRIDE=unlimited` instead, which lifts every limit.

To turn it on:

1. In Stripe, create a product per paid plan with a monthly recurring price whose **lookup key** is `hookline_pro_monthly` or `hookline_team_monthly`. Prices are found by lookup key, so test and live mode need no configuration changes; the amounts shown on the billing page come from Stripe.
2. Configure the Customer Portal (Settings → Billing → Customer portal) to allow plan switching between those prices, payment method updates and cancellation.
3. Add a webhook endpoint for `https://<your domain>/api/stripe/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`.
4. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (the endpoint's signing secret).

Subscription events are the source of truth: the plan follows the price's lookup key while the subscription is `active`, `trialing` or `past_due`, and returns to Free when it is canceled or unpaid. A plan change caps every endpoint's retention to the new plan, refreshes the limits the edge has cached, writes `billing.plan_changed` to the audit log and emails the owners and admins.

### Hookline captures its own Stripe webhooks in development

The seed creates an endpoint `hooklineBill` in the demo organization. Point a Stripe test-mode webhook at its public URL (behind a tunnel or on a deployed edge) and forward it to the local web app with the CLI:

```sh
hookline listen hooklineBill --forward http://localhost:3000/api/stripe/webhook
```

Every billing event is then captured, inspectable and replayable in Hookline's own inbox while you develop. Put the webhook's signing secret in `STRIPE_WEBHOOK_SECRET`; the development value in `.env.example` only works with events you sign yourself (as the end-to-end tests do).

## Plan limits

`config/plans.json` defines every plan; `bun run gen` turns it into the Go and TypeScript entitlement modules. Limits are enforced where the action happens:

| Limit                                         | Enforced by                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests per month                            | Edge, before reading the body: a Redis counter per organization and month, seeded from the database, `429 quota_exceeded` when reached (fails open without Redis) |
| Intake rate and burst, body size              | Edge                                                                                                                                                              |
| Concurrent CLI tunnels                        | Edge, across instances                                                                                                                                            |
| Retention                                     | Worker (capped by the plan in force) and the endpoint settings                                                                                                    |
| Endpoints, destinations per endpoint, members | Web app and API                                                                                                                                                   |
| Audit log days                                | Web app (list and CSV export)                                                                                                                                     |
