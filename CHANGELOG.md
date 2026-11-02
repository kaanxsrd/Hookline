# Changelog

All notable changes to Hookline. One version covers the web app, the edge,
the worker and the CLI. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-11-02

### Fixed

- `npm install -g hookline-cli` now works on Windows x64. The platform binaries
  moved to `@vantedev/hookline-cli-<os>-<cpu>`, because npm blocked the
  unscoped Windows x64 package name.

## [1.0.0] - 2026-10-30

The first stable release of Hookline.

### Capture

- Webhook URLs that accept every method on any sub-path, with configurable status, headers, body and delay.
- Temporary endpoints without an account, which you can keep by signing up.
- A live inbox that updates in about 100 ms and resumes after a disconnect, with filters, full-text search, keyboard shortcuts and JSON tree, form, XML, raw and hex views.
- Sensitive headers masked until revealed, with each reveal audited.
- Copy any request as cURL, fetch or HTTPie.

### Replay

- Replay to a destination, to the CLI or to any URL, as captured or edited.
- Signature verification for Stripe, GitHub, Shopify, Slack, Standard Webhooks, Discord and generic HMAC-SHA256.
- Destinations with method, header and JSON-path filters, durable retries with backoff and an attempt log, optionally signed with Standard Webhooks.

### CLI

- `hookline login` with the device flow, plus `listen`, `tail`, `replay`, `trigger`, `endpoints` and `update`.
- Tunnels that forward to localhost, with path rewrites, extra headers, method filters and sync responses.
- Release builds talk to the hosted service at https://hookline.vante.app by default.

### Teams

- Organizations with viewer, member, admin and owner roles, invitations and an audit log.
- Passkeys and TOTP two-factor authentication.
- A REST API described by OpenAPI, with scoped keys, idempotency keys and rate limits.

### Plans

- Free, Pro and Team plans with a usage page, email alerts at 80 % and 100 %, and Stripe billing.
- Marketing site, documentation, a status page and an administration area for instance operators.

### Design

- An animated marketing site and documentation with live terminal, event and timeline sections.
- A dashboard with a getting-started checklist, metric cards and charts, status pills, breadcrumbs and a usage meter in the sidebar.
- Animations respect the reduced-motion setting of your system.

### Self-hosting

- Production images for the web app, edge, worker and migrations, a Docker Compose setup with Caddy, TLS and daily backups, and Fly.io and Railway configurations.
- Email through Resend over HTTPS (`RESEND_API_KEY`) or any SMTP server, for hosts that block outgoing SMTP.
- Deploys to Railway after CI passes on `main`, migrations first, then a smoke test.
- The CLI on Homebrew, Scoop and npm, with archives for macOS, Linux and Windows.
- A load-testing script and vulnerability scanning in CI.
- Licensed under the GNU General Public License v3.0.

[1.0.1]: https://github.com/kaanxsrd/hookline/releases/tag/v1.0.1
[1.0.0]: https://github.com/kaanxsrd/hookline/releases/tag/v1.0.0
