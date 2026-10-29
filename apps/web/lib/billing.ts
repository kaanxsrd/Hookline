import "server-only";
import { type Db, schema } from "@hookline/db";
import { limitsFor } from "@hookline/shared";
import { and, eq, gt, inArray } from "drizzle-orm";
import Stripe from "stripe";
import { PlanChanged } from "@/emails/notification-emails";
import { writeAudit } from "./audit";
import { env } from "./env";
import { sendEmailInBackground } from "./mail";
import { invalidateEndpointCache } from "./redis";

/**
 * Stripe billing. Off unless STRIPE_SECRET_KEY is set; webhooks need
 * STRIPE_WEBHOOK_SECRET. Prices are found by lookup key, so the same code
 * works in test and live mode: create a monthly recurring price for each paid
 * plan with the lookup keys below.
 */
export const PRICE_LOOKUP_KEYS = {
  pro: "hookline_pro_monthly",
  team: "hookline_team_monthly",
} as const;
export type PaidPlan = keyof typeof PRICE_LOOKUP_KEYS;
type Plan = "free" | PaidPlan;

export function billingEnabled(): boolean {
  return Boolean(env().STRIPE_SECRET_KEY);
}

let client: Stripe | undefined;
function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("billing is not configured (STRIPE_SECRET_KEY)");
  client ??= new Stripe(key, { appInfo: { name: "Hookline" } });
  return client;
}

const s = schema.subscription;

async function subscriptionRow(db: Db, orgId: string) {
  await db.insert(s).values({ orgId }).onConflictDoNothing({ target: s.orgId });
  const [row] = await db.select().from(s).where(eq(s.orgId, orgId));
  if (!row) throw new Error("subscription row missing");
  return row;
}

/** A Stripe customer for the organization, created on first use. */
async function customerFor(
  db: Db,
  org: { id: string; name: string },
  email: string,
): Promise<string> {
  const row = await subscriptionRow(db, org.id);
  if (row.stripeCustomerId) return row.stripeCustomerId;
  const customer = await stripe().customers.create(
    { name: org.name, email, metadata: { org_id: org.id } },
    { idempotencyKey: `customer-${org.id}` },
  );
  await db.update(s).set({ stripeCustomerId: customer.id }).where(eq(s.orgId, org.id));
  return customer.id;
}

/** A Checkout session that subscribes the organization to a paid plan. */
export async function createCheckout(
  db: Db,
  org: { id: string; slug: string; name: string },
  plan: PaidPlan,
  email: string,
): Promise<string> {
  const prices = await stripe().prices.list({
    lookup_keys: [PRICE_LOOKUP_KEYS[plan]],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) throw new Error(`no active Stripe price with lookup key ${PRICE_LOOKUP_KEYS[plan]}`);
  const base = `${env().APP_URL}/${org.slug}/settings/billing`;
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: await customerFor(db, org, email),
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: org.id,
    metadata: { org_id: org.id },
    subscription_data: { metadata: { org_id: org.id } },
    allow_promotion_codes: true,
    success_url: `${base}?checkout=success`,
    cancel_url: `${base}?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe returned no Checkout URL");
  return session.url;
}

/** The Customer Portal, for payment methods, invoices, plan changes and cancellation. */
export async function createPortal(db: Db, org: { id: string; slug: string }): Promise<string> {
  const row = await subscriptionRow(db, org.id);
  if (!row.stripeCustomerId) throw new Error("this organization has no Stripe customer yet");
  const session = await stripe().billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${env().APP_URL}/${org.slug}/settings/billing`,
  });
  return session.url;
}

/** Verifies a webhook's signature (no API key needed) and returns the event. */
export function verifyWebhook(payload: string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);

function planOf(sub: Stripe.Subscription): Plan {
  if (!ACTIVE.has(sub.status)) return "free";
  const key = sub.items.data[0]?.price.lookup_key;
  const match = (Object.entries(PRICE_LOOKUP_KEYS) as [PaidPlan, string][]).find(
    ([, k]) => k === key,
  );
  return match?.[0] ?? "free";
}

/**
 * Applies Stripe events. Subscription events are the source of truth: they
 * set the plan from the price's lookup key, the status and the period end.
 */
export async function handleBillingEvent(db: Db, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      let orgId = sub.metadata.org_id;
      if (!orgId) {
        const [row] = await db
          .select({ orgId: s.orgId })
          .from(s)
          .where(eq(s.stripeCustomerId, customer));
        orgId = row?.orgId;
      }
      if (!orgId) return; // not one of ours
      const current = await subscriptionRow(db, orgId);
      const plan = event.type === "customer.subscription.deleted" ? "free" : planOf(sub);
      const periodEnd = sub.items.data[0]?.current_period_end;
      await db
        .update(s)
        .set({
          plan,
          status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
          stripeCustomerId: customer,
          stripeSubscriptionId: event.type === "customer.subscription.deleted" ? null : sub.id,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        })
        .where(eq(s.orgId, orgId));
      if (current.plan !== plan) await planChanged(db, orgId, current.plan, plan);
      return;
    }
    case "checkout.session.completed": {
      const session = event.data.object;
      const orgId = session.metadata?.org_id ?? session.client_reference_id;
      const customer =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (orgId && customer) {
        await subscriptionRow(db, orgId);
        await db.update(s).set({ stripeCustomerId: customer }).where(eq(s.orgId, orgId));
      }
      return;
    }
    default:
      return;
  }
}

/**
 * Makes a plan change take effect: caps endpoint retention to the new plan,
 * drops the edge's cached limits, audits it and tells the owners and admins.
 */
export async function planChanged(db: Db, orgId: string, from: string, to: Plan): Promise<void> {
  const limits = limitsFor(to);
  const e = schema.endpoint;
  await db
    .update(e)
    .set({ retentionHours: limits.retention_hours })
    .where(and(eq(e.orgId, orgId), gt(e.retentionHours, limits.retention_hours)));
  const endpoints = await db.select({ slug: e.slug }).from(e).where(eq(e.orgId, orgId));
  await Promise.all(endpoints.map((x) => invalidateEndpointCache(x.slug)));
  await writeAudit(db, {
    orgId,
    action: "billing.plan_changed",
    targetType: "organization",
    targetId: orgId,
    metadata: { from, to },
  });

  const [org] = await db
    .select({ name: schema.organization.name, slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId));
  const admins = await db
    .select({ email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      and(eq(schema.member.organizationId, orgId), inArray(schema.member.role, ["owner", "admin"])),
    );
  if (!org) return;
  for (const { email } of admins) {
    sendEmailInBackground({
      to: email,
      subject: `${org.name} is now on the ${limits.name} plan`,
      body: PlanChanged({
        orgName: org.name,
        plan: limits.name,
        url: `${env().APP_URL}/${org.slug}/settings/billing`,
      }),
    });
  }
}

let priceCache: { at: number; prices: Partial<Record<PaidPlan, string>> } | undefined;

/** Monthly prices from Stripe, formatted ("$19.00 / month"); cached for ten minutes. */
export async function planPrices(): Promise<Partial<Record<PaidPlan, string>>> {
  if (!billingEnabled()) return {};
  if (priceCache && Date.now() - priceCache.at < 600_000) return priceCache.prices;
  const list = await stripe().prices.list({
    lookup_keys: Object.values(PRICE_LOOKUP_KEYS),
    active: true,
  });
  const prices: Partial<Record<PaidPlan, string>> = {};
  for (const [plan, key] of Object.entries(PRICE_LOOKUP_KEYS) as [PaidPlan, string][]) {
    const p = list.data.find((x) => x.lookup_key === key);
    if (p?.unit_amount != null) {
      const amount = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: p.currency.toUpperCase(),
      }).format(p.unit_amount / 100);
      prices[plan] = `${amount} / ${p.recurring?.interval ?? "month"}`;
    }
  }
  priceCache = { at: Date.now(), prices };
  return prices;
}
