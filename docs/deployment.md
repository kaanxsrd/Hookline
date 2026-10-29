# Deployment

Configuration is entirely through environment variables; `.env.example` lists every one with development values. This document covers the optional integrations; production images, Caddy, `docker-compose.prod.yml`, Fly.io and backups are documented with the release tooling.

## Email

Set `SMTP_URL` (`smtp://user:pass@host:587` uses STARTTLS when offered, `smtps://user:pass@host:465` implicit TLS) and `MAIL_FROM`. The web app sends account emails (verification, password reset, invitations, plan changes); the worker sends operational notifications to each organization's owners and admins:

- **Deliveries failing:** when a delivery fails after its last attempt, at most once an hour per destination.
- **Usage:** when an organization passes 80 % and 100 % of its monthly requests, once each per month (checked after the hourly usage rollup).

Without `SMTP_URL` the worker logs that notifications are disabled and skips them. The notification templates are React Email components in `apps/web/emails`; `bun run gen` renders them into Go templates (`packages/gocommon/mail/templates`), so both services send the same design.

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
