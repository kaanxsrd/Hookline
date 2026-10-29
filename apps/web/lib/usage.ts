import "server-only";
import { type Db, schema } from "@hookline/db";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { orgPlan } from "./plans";

/** The current UTC calendar month. */
export function currentPeriod(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Usage this month: the worker's hourly rollup (usage_daily) for past days
 * plus a live count of today's requests, so limits react within seconds.
 */
export async function monthUsage(db: Db, orgId: string, now = new Date()) {
  const { start, end } = currentPeriod(now);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const u = schema.usageDaily;
  const r = schema.request;

  const [past] = await db
    .select({
      requests: sql<number>`coalesce(sum(${u.requests}) FILTER (WHERE ${u.day} < ${day(today)}), 0)::bigint`,
      bytes: sql<number>`coalesce(sum(${u.bytes}) FILTER (WHERE ${u.day} < ${day(today)}), 0)::bigint`,
      deliveries: sql<number>`coalesce(sum(${u.deliveries}), 0)::bigint`,
      tunnelMinutes: sql<number>`coalesce(sum(${u.tunnelMinutes}), 0)::bigint`,
    })
    .from(u)
    .where(and(eq(u.orgId, orgId), gte(u.day, day(start)), lt(u.day, day(end))));
  const [live] = await db
    .select({ requests: count(), bytes: sql<number>`coalesce(sum(${r.bodySize}), 0)::bigint` })
    .from(r)
    .where(and(eq(r.orgId, orgId), gte(r.receivedAt, today)));
  const [endpoints] = await db
    .select({ n: count() })
    .from(schema.endpoint)
    .where(eq(schema.endpoint.orgId, orgId));
  const { plan, limits } = await orgPlan(db, orgId);

  return {
    plan,
    period_start: day(start),
    period_end: day(new Date(end.getTime() - 86_400_000)),
    requests: {
      used: Number(past?.requests ?? 0) + (live?.requests ?? 0),
      limit: limits.requests_per_month,
    },
    bytes: Number(past?.bytes ?? 0) + Number(live?.bytes ?? 0),
    deliveries: Number(past?.deliveries ?? 0),
    tunnel_minutes: Number(past?.tunnelMinutes ?? 0),
    endpoints: { used: endpoints?.n ?? 0, limit: limits.endpoints },
  };
}
