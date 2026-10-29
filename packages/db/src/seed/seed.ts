/**
 * Development seed: an admin, a member, a demo organization and endpoints
 * with realistic captured traffic, destinations and delivery history.
 *
 * Idempotent: users, the organization and endpoints are matched by their
 * natural keys, and traffic is generated only for endpoints that have none,
 * so running it again changes nothing.
 */
import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, count, eq, sql } from "drizzle-orm";
import type { Db } from "../index";
import {
  account,
  auditLog,
  delivery,
  deliveryAttempt,
  destination,
  endpoint,
  member,
  organization,
  type Pair,
  request,
  subscription,
  user,
} from "../schema";
import { uuidv7 } from "../uuid";
import {
  createRng,
  type Fixture,
  genericFixture,
  githubFixture,
  type Rng,
  shopifyFixture,
  stripeFixture,
} from "./fixtures";

export const SEED_ACCOUNTS = {
  admin: { name: "Ada Admin", email: "admin@hookline.local" },
  member: { name: "Max Member", email: "member@hookline.local" },
} as const;

export const SEED_ORG = { name: "Demo Org", slug: "demo" } as const;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type EndpointSeed = {
  slug: string;
  name: string;
  description: string;
  responseStatus: number;
  responseHeaders: Pair[];
  responseBody: string;
  requests: number;
  fixture: (rng: Rng, at: Date) => Fixture;
  destination?: { name: string; url: string };
};

const jsonHeaders: Pair[] = [["Content-Type", "application/json"]];

export const SEED_ENDPOINTS: EndpointSeed[] = [
  {
    slug: "demoStripe01",
    name: "Stripe payments",
    description: "Checkout and subscription events from Stripe (test mode).",
    responseStatus: 200,
    responseHeaders: jsonHeaders,
    responseBody: '{"received":true}',
    requests: 30,
    fixture: stripeFixture,
    destination: {
      name: "Billing service (staging)",
      url: "https://billing.staging.example.com/webhooks/stripe",
    },
  },
  {
    slug: "demoGitHub01",
    name: "GitHub storefront repo",
    description: "Push, pull request and issue events for acme-labs/storefront.",
    responseStatus: 202,
    responseHeaders: [],
    responseBody: "",
    requests: 24,
    fixture: githubFixture,
    destination: { name: "CI notifier", url: "https://ci.example.com/hooks/github" },
  },
  {
    slug: "demoShopify1",
    name: "Shopify orders",
    description: "Order, product and customer events from the demo store.",
    responseStatus: 200,
    responseHeaders: [],
    responseBody: "",
    requests: 16,
    fixture: shopifyFixture,
  },
  {
    slug: "demoGeneric1",
    name: "Generic inbox",
    description: "Anything else: forms, XML callbacks, device pings and uploads.",
    responseStatus: 200,
    responseHeaders: [["Content-Type", "text/plain; charset=utf-8"]],
    responseBody: "ok",
    requests: 12,
    fixture: genericFixture,
  },
  {
    // Hookline captures its own billing webhooks in development: point a
    // Stripe test-mode webhook at this endpoint and run
    // `hookline listen hooklineBill --forward http://localhost:3000/api/stripe/webhook`.
    slug: "hooklineBill",
    name: "Hookline billing (dev)",
    description:
      "This instance's own Stripe webhooks, forwarded to /api/stripe/webhook with the CLI.",
    responseStatus: 200,
    responseHeaders: jsonHeaders,
    responseBody: '{"received":true}',
    requests: 0,
    fixture: stripeFixture,
  },
];

export type SeedSummary = {
  adminUserId: string;
  orgId: string;
  usersCreated: number;
  endpointsCreated: number;
  requestsCreated: number;
  deliveriesCreated: number;
};

export type SeedOptions = {
  /** Password for both seeded accounts. */
  password: string;
  now?: Date;
};

const HOUR = 3_600_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function seed(db: Db, options: SeedOptions): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  // scrypt is slow; hash once, outside the transaction.
  const passwordHash = await hashPassword(options.password);

  return db.transaction(async (tx) => {
    const summary: SeedSummary = {
      adminUserId: "",
      orgId: "",
      usersCreated: 0,
      endpointsCreated: 0,
      requestsCreated: 0,
      deliveriesCreated: 0,
    };

    const admin = await ensureUser(tx, { ...SEED_ACCOUNTS.admin, isAdmin: true }, passwordHash);
    const regular = await ensureUser(tx, { ...SEED_ACCOUNTS.member, isAdmin: false }, passwordHash);
    summary.adminUserId = admin.id;
    summary.usersCreated = Number(admin.created) + Number(regular.created);

    const orgId = await ensureRow(
      () =>
        tx
          .insert(organization)
          .values(SEED_ORG)
          .onConflictDoNothing({ target: organization.slug })
          .returning({ id: organization.id }),
      () =>
        tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.slug, SEED_ORG.slug)),
    );
    summary.orgId = orgId.id;

    await tx
      .insert(member)
      .values([
        { organizationId: orgId.id, userId: admin.id, role: "owner" },
        { organizationId: orgId.id, userId: regular.id, role: "member" },
      ])
      .onConflictDoNothing();
    await tx
      .insert(subscription)
      .values({ orgId: orgId.id, plan: "pro" })
      .onConflictDoNothing({ target: subscription.orgId });

    await tx.execute(
      sql`SELECT hookline_ensure_request_partitions(${day(new Date(now.getTime() - 96 * HOUR))}::date, ${day(new Date(now.getTime() + 7 * 24 * HOUR))}::date)`,
    );

    for (const [index, spec] of SEED_ENDPOINTS.entries()) {
      const ep = await ensureRow(
        () =>
          tx
            .insert(endpoint)
            .values({
              orgId: orgId.id,
              slug: spec.slug,
              name: spec.name,
              description: spec.description,
              responseStatus: spec.responseStatus,
              responseHeaders: spec.responseHeaders,
              responseBody: spec.responseBody,
              retentionHours: 14 * 24,
            })
            .onConflictDoNothing({ target: endpoint.slug })
            .returning({ id: endpoint.id }),
        () => tx.select({ id: endpoint.id }).from(endpoint).where(eq(endpoint.slug, spec.slug)),
      );
      if (ep.created) {
        summary.endpointsCreated++;
        await tx.insert(auditLog).values({
          orgId: orgId.id,
          actorUserId: admin.id,
          action: "endpoint.created",
          targetType: "endpoint",
          targetId: ep.id,
          metadata: { slug: spec.slug, name: spec.name },
        });
      }

      const [existing] = await tx
        .select({ n: count() })
        .from(request)
        .where(eq(request.endpointId, ep.id));
      if ((existing?.n ?? 0) > 0) continue;

      const rng = createRng(1000 + index);
      const rows = Array.from({ length: spec.requests }, () => {
        const receivedAt = new Date(now.getTime() - rng.int(5 * 60_000, 72 * HOUR));
        return toRequestRow(spec.fixture(rng, receivedAt), receivedAt, ep.id, orgId.id, spec, rng);
      }).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
      if (rows.length > 0) await tx.insert(request).values(rows);
      summary.requestsCreated += rows.length;

      if (spec.destination) {
        summary.deliveriesCreated += await seedDeliveries(tx, rng, {
          endpointId: ep.id,
          orgId: orgId.id,
          destination: spec.destination,
          requests: rows,
          now,
        });
      }
    }

    // Derived data, recomputed every run so it always matches the rows above.
    await tx.execute(sql`
      UPDATE endpoint e
      SET request_count = s.n, last_request_at = s.last
      FROM (
        SELECT endpoint_id, count(*) AS n, max(received_at) AS last
        FROM request WHERE org_id = ${orgId.id} GROUP BY endpoint_id
      ) s
      WHERE e.id = s.endpoint_id`);
    await tx.execute(sql`
      INSERT INTO usage_daily (org_id, day, requests, bytes, deliveries)
      SELECT ${orgId.id}::uuid, d.day, coalesce(r.requests, 0), coalesce(r.bytes, 0), coalesce(dl.deliveries, 0)
      FROM (
        SELECT (received_at AT TIME ZONE 'UTC')::date AS day FROM request WHERE org_id = ${orgId.id}
        UNION
        SELECT (created_at AT TIME ZONE 'UTC')::date FROM delivery WHERE org_id = ${orgId.id}
      ) d
      LEFT JOIN (
        SELECT (received_at AT TIME ZONE 'UTC')::date AS day, count(*) AS requests, sum(body_size) AS bytes
        FROM request WHERE org_id = ${orgId.id} GROUP BY 1
      ) r ON r.day = d.day
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS deliveries
        FROM delivery WHERE org_id = ${orgId.id} GROUP BY 1
      ) dl ON dl.day = d.day
      ON CONFLICT (org_id, day) DO UPDATE
      SET requests = EXCLUDED.requests, bytes = EXCLUDED.bytes, deliveries = EXCLUDED.deliveries`);

    return summary;
  });
}

async function ensureUser(
  tx: Tx,
  values: { name: string; email: string; isAdmin: boolean },
  passwordHash: string,
): Promise<{ id: string; created: boolean }> {
  const row = await ensureRow(
    () =>
      tx
        .insert(user)
        .values({ ...values, emailVerified: true })
        .onConflictDoNothing({ target: user.email })
        .returning({ id: user.id }),
    () => tx.select({ id: user.id }).from(user).where(eq(user.email, values.email)),
  );
  if (row.created) {
    // Better Auth's email/password accounts use provider "credential" and the user ID.
    await tx.insert(account).values({
      userId: row.id,
      accountId: row.id,
      providerId: "credential",
      password: passwordHash,
    });
  }
  return row;
}

/** Runs an INSERT ... ON CONFLICT DO NOTHING RETURNING id, falling back to a lookup when the row exists. */
async function ensureRow(
  insert: () => PromiseLike<{ id: string }[]>,
  lookup: () => PromiseLike<{ id: string }[]>,
): Promise<{ id: string; created: boolean }> {
  const [inserted] = await insert();
  if (inserted) return { id: inserted.id, created: true };
  const [found] = await lookup();
  if (!found) throw new Error("row vanished between insert and lookup");
  return { id: found.id, created: false };
}

function toRequestRow(
  f: Fixture,
  receivedAt: Date,
  endpointId: string,
  orgId: string,
  spec: EndpointSeed,
  rng: Rng,
): typeof request.$inferInsert & { receivedAt: Date; id: string } {
  return {
    id: uuidv7(receivedAt),
    receivedAt,
    endpointId,
    orgId,
    method: f.method,
    path: f.path,
    query: f.query,
    headers: f.headers,
    contentType: f.contentType,
    bodyInline: f.body.length > 0 ? f.body : null,
    bodySize: f.body.length,
    bodySha256: createHash("sha256").update(f.body).digest(),
    sourceIp: f.sourceIp,
    userAgent: f.userAgent,
    signatureStatus: "unchecked",
    responseStatus: spec.responseStatus,
    durationMs: Math.round((1 + rng.next() * 5) * 100) / 100,
  };
}

async function seedDeliveries(
  tx: Tx,
  rng: Rng,
  opts: {
    endpointId: string;
    orgId: string;
    destination: { name: string; url: string };
    requests: { id: string; receivedAt: Date }[];
    now: Date;
  },
): Promise<number> {
  // Disabled so a running worker never sends seed traffic anywhere.
  const [existing] = await tx
    .select({ id: destination.id })
    .from(destination)
    .where(
      and(eq(destination.endpointId, opts.endpointId), eq(destination.name, opts.destination.name)),
    );
  const [inserted] = existing
    ? [existing]
    : await tx
        .insert(destination)
        .values({
          endpointId: opts.endpointId,
          name: opts.destination.name,
          url: opts.destination.url,
          enabled: false,
          maxAttempts: 3,
          timeoutMs: 10_000,
        })
        .returning({ id: destination.id });
  if (!inserted) throw new Error("destination insert returned no row");
  const dest = inserted;

  const okHeaders: Pair[] = [
    ["Content-Type", "application/json"],
    ["Server", "nginx"],
  ];
  const ok = (startedAt: Date) => ({
    statusCode: 200,
    responseHeaders: okHeaders,
    responseBody: Buffer.from('{"ok":true}'),
    durationMs: rng.int(25, 240),
    startedAt,
  });
  const unavailable = (startedAt: Date) => ({
    statusCode: 503,
    responseHeaders: [
      ["Content-Type", "text/html"],
      ["Retry-After", "30"],
    ] satisfies Pair[],
    responseBody: Buffer.from("<html><body><h1>503 Service Unavailable</h1></body></html>"),
    durationMs: rng.int(5, 40),
    startedAt,
  });
  const timeout = (startedAt: Date) => ({
    statusCode: null,
    error: "timeout: no response within 10s",
    responseHeaders: [] as Pair[],
    responseBody: null,
    durationMs: 10_000,
    startedAt,
  });

  let created = 0;
  for (const req of opts.requests) {
    const roll = rng.next();
    const first = new Date(req.receivedAt.getTime() + rng.int(20, 120));
    const retry = (n: number) => new Date(first.getTime() + 10_000 * 2 ** (n - 1));
    let attempts: ReturnType<typeof ok | typeof unavailable | typeof timeout>[];
    let status: "succeeded" | "failed" | "pending";
    if (roll < 0.8) {
      attempts = [ok(first)];
      status = "succeeded";
    } else if (roll < 0.9) {
      attempts = [unavailable(first), ok(retry(1))];
      status = "succeeded";
    } else if (roll < 0.97 || req.receivedAt.getTime() < opts.now.getTime() - HOUR) {
      attempts = [unavailable(first), timeout(retry(1)), unavailable(retry(2))];
      status = "failed";
    } else {
      attempts = [timeout(first)];
      status = "pending";
    }

    const last = attempts.at(-1);
    const [row] = await tx
      .insert(delivery)
      .values({
        requestId: req.id,
        requestReceivedAt: req.receivedAt,
        destinationId: dest.id,
        endpointId: opts.endpointId,
        orgId: opts.orgId,
        status,
        attemptCount: attempts.length,
        lastStatusCode: last?.statusCode ?? null,
        nextAttemptAt: status === "pending" ? retry(attempts.length) : null,
        trigger: "auto",
        createdAt: req.receivedAt,
      })
      .returning({ id: delivery.id });
    if (!row) throw new Error("delivery insert returned no row");
    await tx
      .insert(deliveryAttempt)
      .values(attempts.map((a, i) => ({ ...a, deliveryId: row.id, attemptNo: i + 1 })));
    created++;
  }
  return created;
}
