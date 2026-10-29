import "server-only";
import { type Db, schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { insertDeliveries } from "@/lib/deliveries";
import { orgProcedure, router } from "../trpc/init";

const dlv = schema.delivery;
const dst = schema.destination;
const ep = schema.endpoint;
const req = schema.request;

/** Most deliveries one bulk retry re-sends. */
export const BULK_RETRY_LIMIT = 500;

const filterSchema = z.object({
  status: z
    .array(z.enum(["pending", "succeeded", "failed", "cancelled"]))
    .max(4)
    .optional(),
  endpointSlug: z.string().max(64).optional(),
  destinationId: z.uuid().optional(),
  trigger: z
    .array(z.enum(["auto", "replay", "manual"]))
    .max(3)
    .optional(),
});

/** A later delivery of the same request to the same destination (a retry of this one). */
const retriedLater = sql`EXISTS (
  SELECT 1 FROM delivery later WHERE later.request_id = ${dlv.requestId}
    AND later.destination_id = ${dlv.destinationId} AND later.id > ${dlv.id}
)`;

function filterWhere(orgId: string, f: z.infer<typeof filterSchema>): SQL {
  const parts: (SQL | undefined)[] = [eq(dlv.orgId, orgId)];
  if (f.status?.length) parts.push(inArray(dlv.status, f.status));
  if (f.trigger?.length) parts.push(inArray(dlv.trigger, f.trigger));
  if (f.endpointSlug) parts.push(eq(ep.slug, f.endpointSlug));
  if (f.destinationId) parts.push(eq(dlv.destinationId, f.destinationId));
  return and(...parts) as SQL;
}

/** New manual deliveries (see insertDeliveries). */
export function insertManualDeliveries(db: Db, orgId: string, source: SQL): Promise<string[]> {
  return insertDeliveries(db, orgId, source, { trigger: "manual" });
}

/** Copies of these deliveries' targets, as an insertManualDeliveries source. */
function sameTargetsAs(where: SQL, limit: number): SQL {
  return sql`SELECT ${dlv.requestId} AS request_id, ${dlv.requestReceivedAt} AS request_received_at,
      ${dlv.destinationId} AS destination_id, ${dlv.endpointId} AS endpoint_id
    FROM ${dlv} INNER JOIN ${ep} ON ${ep.id} = ${dlv.endpointId}
    WHERE ${where} ORDER BY ${dlv.id} DESC LIMIT ${limit}`;
}

/** Only deliveries whose request still exists can be sent again. */
function requestStillExists() {
  return sql`EXISTS (
    SELECT 1 FROM ${req} WHERE ${req.id} = ${dlv.requestId} AND ${req.receivedAt} = ${dlv.requestReceivedAt}
  )`;
}

export const deliveryRouter = router({
  /** Newest first across the organization. The cursor is the last delivery ID of the previous page. */
  list: orgProcedure
    .input(
      filterSchema.extend({
        cursor: z.uuid().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        filterWhere(ctx.org.id, input),
        input.cursor ? lt(dlv.id, input.cursor) : undefined,
      );
      const rows = await ctx.db
        .select({
          id: dlv.id,
          status: dlv.status,
          trigger: dlv.trigger,
          attemptCount: dlv.attemptCount,
          lastStatusCode: dlv.lastStatusCode,
          nextAttemptAt: dlv.nextAttemptAt,
          createdAt: dlv.createdAt,
          updatedAt: dlv.updatedAt,
          requestId: dlv.requestId,
          destinationId: dst.id,
          destinationName: dst.name,
          destinationUrl: dst.url,
          maxAttempts: dst.maxAttempts,
          endpointSlug: ep.slug,
          endpointName: ep.name,
          retried: sql<boolean>`${retriedLater}`,
          lastError: sql<string | null>`(
            SELECT a.error FROM delivery_attempt a WHERE a.delivery_id = ${dlv.id}
            ORDER BY a.attempt_no DESC LIMIT 1
          )`,
        })
        .from(dlv)
        .innerJoin(dst, eq(dst.id, dlv.destinationId))
        .innerJoin(ep, eq(ep.id, dlv.endpointId))
        .where(where)
        .orderBy(desc(dlv.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return { items, nextCursor: hasMore ? items.at(-1)?.id : undefined };
    }),

  /** Failed deliveries matching the filters that have not been retried yet. */
  retryableCount: orgProcedure.input(filterSchema).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(dlv)
      .innerJoin(ep, eq(ep.id, dlv.endpointId))
      .where(
        and(filterWhere(ctx.org.id, input), eq(dlv.status, "failed"), sql`NOT ${retriedLater}`),
      );
    return { count: row?.n ?? 0, limit: BULK_RETRY_LIMIT };
  }),

  /** Sends a delivery's request to its destination again, as a new manual delivery. */
  retry: orgProcedure
    .meta({ role: "member" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ requestExists: sql<boolean>`${requestStillExists()}` })
        .from(dlv)
        .where(and(eq(dlv.id, input.id), eq(dlv.orgId, ctx.org.id)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Delivery not found." });
      if (!row.requestExists) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The request was deleted or is past its retention, so it cannot be sent again.",
        });
      }
      const [id] = await insertManualDeliveries(
        ctx.db,
        ctx.org.id,
        sameTargetsAs(and(eq(dlv.id, input.id), eq(dlv.orgId, ctx.org.id)) as SQL, 1),
      );
      ctx.audit({ type: "delivery", id: input.id, metadata: { retry: id } });
      return { id };
    }),

  /** Retries every failed, not-yet-retried delivery matching the filters (up to BULK_RETRY_LIMIT). */
  bulkRetry: orgProcedure
    .meta({ role: "member", audit: "delivery.bulk_retry" })
    .input(filterSchema)
    .mutation(async ({ ctx, input }) => {
      // A delivery with no later one for the same pair is the latest attempt
      // at it, so each pair is retried at most once per click.
      const ids = await insertManualDeliveries(
        ctx.db,
        ctx.org.id,
        sameTargetsAs(
          and(
            filterWhere(ctx.org.id, input),
            eq(dlv.status, "failed"),
            sql`NOT ${retriedLater}`,
            requestStillExists(),
          ) as SQL,
          BULK_RETRY_LIMIT,
        ),
      );
      ctx.audit({ type: "delivery", metadata: { filters: input, retried: ids.length } });
      return { retried: ids.length };
    }),
});
