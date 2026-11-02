# Changelog

Every notable change to Hookline, newest first. One version covers the web
app, the edge, the worker and the CLI. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-11-02

### 🐛 Fixed

- **`npm install -g hookline-cli` works on Windows x64.** npm's spam filter
  blocked the package name of the Windows x64 binary, so the install failed
  there. The platform binaries now live under `@vantedev/hookline-cli-<os>-<cpu>`;
  the install command and the `hookline` command are unchanged.

### 🔧 Release

- Release notes come from this changelog.
- When the npm token cannot publish without a second factor, the release stages
  the packages for approval instead of failing.

## [1.0.0] - 2026-10-30

The first stable release of Hookline. 🎉

### ✨ Highlights

- 📥 **Catch** webhooks on a URL that accepts any method and path, and watch them arrive live.
- 🔁 **Replay** any request to a destination, to your machine or to any URL, as captured or edited.
- 💻 **Tunnel** webhooks to `localhost` with `hookline listen`.
- 🛡️ **Verify** signatures from Stripe, GitHub, Shopify, Slack, Discord and Standard Webhooks.

### 📥 Capture

- Webhook URLs that accept every method on any sub-path, with a configurable status, headers, body and delay.
- Temporary endpoints without an account; sign up to keep them.
- A live inbox that updates in about 100 ms and picks up where it left off after a disconnect.
- Filters, full-text search and keyboard shortcuts.
- JSON tree, form, XML, raw and hex views of every body.
- Sensitive headers stay masked until revealed, and every reveal is audited.
- Copy any request as cURL, fetch or HTTPie.

### 🔁 Replay and forwarding

- Replay to a destination, to the CLI or to any URL, as captured or edited.
- Signature checks for Stripe, GitHub, Shopify, Slack, Standard Webhooks, Discord and generic HMAC-SHA256.
- Destinations with method, header and JSON-path filters.
- Durable retries with backoff and an attempt log, optionally signed with Standard Webhooks.

### 💻 CLI

- `hookline login` through the browser, plus `listen`, `tail`, `replay`, `trigger`, `endpoints` and `update`.
- Tunnels to `localhost` with path rewrites, extra headers, method filters and synchronous responses.
- Talks to [hookline.vante.app](https://hookline.vante.app) by default.
- Install it with npm, Homebrew or Scoop, or download an archive for macOS, Linux or Windows.

### 👥 Teams and API

- Organizations with viewer, member, admin and owner roles, invitations and an audit log.
- Passkeys and TOTP two-factor authentication.
- A REST API described by OpenAPI, with scoped keys, idempotency keys and rate limits.

### 💳 Plans

- Free, Pro and Team plans with Stripe billing.
- A usage page, and email alerts at 80 % and 100 % of a limit.

### 🎨 Design

- An animated marketing site and documentation.
- A dashboard with a getting-started checklist, metric cards, charts and a usage meter.
- Animations follow your system's reduced-motion setting.

### 🏠 Self-hosting

- Production images for the web app, edge, worker and migrations.
- Docker Compose with Caddy, automatic TLS and daily backups; Fly.io and Railway configurations.
- Email through Resend over HTTPS or any SMTP server.
- Deploys to Railway once CI passes on `main`: migrations first, then a smoke test.
- An administration area, a status page, a load-testing script and vulnerability scanning in CI.
- Free software under the GNU General Public License v3.0.

[1.0.1]: https://github.com/kaanxsrd/Hookline/releases/tag/v1.0.1
[1.0.0]: https://github.com/kaanxsrd/Hookline/releases/tag/v1.0.0
