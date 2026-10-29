import { schema } from "@hookline/db";
import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { json, page, pageQuery, readQuery } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";

const d = schema.delivery;
const e = schema.endpoint;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const query = pageQuery.extend({
  status: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(["pending", "succeeded", "failed", "cancelled"])).max(4))
    .optional(),
  endpoint: z.string().max(64).optional(),
  destination: z.uuid().optional(),
});

/** Deliveries across the organization, newest first. */
export const GET = apiRoute("requests:read", async ({ request, caller: { db, org } }) => {
  const q = readQuery(request, query);
  const where: (SQL | undefined)[] = [eq(d.orgId, org.id)];
  if (q.cursor) where.push(lt(d.id, q.cursor));
  if (q.status?.length) where.push(inArray(d.status, q.status));
  if (q.destination) where.push(eq(d.destinationId, q.destination));
  if (q.endpoint) {
    where.push(
      UUID.test(q.endpoint)
        ? or(eq(e.id, q.endpoint), eq(e.slug, q.endpoint))
        : eq(e.slug, q.endpoint),
    );
  }
  const rows = await db
    .select({
      id: d.id,
      request_id: d.requestId,
      endpoint_id: d.endpointId,
      destination_id: d.destinationId,
      status: d.status,
      trigger: d.trigger,
      attempt_count: d.attemptCount,
      last_status_code: d.lastStatusCode,
      next_attempt_at: d.nextAttemptAt,
      created_at: d.createdAt,
      updated_at: d.updatedAt,
    })
    .from(d)
    .innerJoin(e, eq(e.id, d.endpointId))
    .where(and(...where))
    .orderBy(desc(d.id))
    .limit(q.limit + 1);
  return json(page(rows, q.limit));
});
