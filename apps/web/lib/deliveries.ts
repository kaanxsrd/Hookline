import "server-only";
import { type Db, schema } from "@hookline/db";
import type { Pair } from "@hookline/db/schema";
import { inArray, type SQL, sql } from "drizzle-orm";
import type { DeliveryStatus } from "@/components/inbox/types";
import { enqueueDeliveries } from "./jobs";
import { publishEndpointEvent } from "./redis";

const dlv = schema.delivery;

/** An edited request to send instead of the captured one. */
export type RequestOverride = {
  method: string;
  path: string;
  query: Pair[];
  headers: Pair[];
  body: Uint8Array | null;
};

/**
 * Inserts deliveries (selected by `source`, which must yield request_id,
 * request_received_at, destination_id, endpoint_id), an optional edited
 * request for each, and their jobs in one transaction, then tells open
 * inboxes. Timestamps are copied in SQL: JavaScript dates would drop the
 * microseconds that locate the request.
 */
export async function insertDeliveries(
  db: Db,
  orgId: string,
  source: SQL,
  options: { trigger: "manual" | "replay"; override?: RequestOverride },
): Promise<string[]> {
  const rows = await db.transaction(async (tx) => {
    const inserted = await tx.execute<{ id: string; request_id: string; endpoint_id: string }>(sql`
      INSERT INTO delivery (request_id, request_received_at, destination_id, endpoint_id, org_id, trigger)
      SELECT s.request_id, s.request_received_at, s.destination_id, s.endpoint_id, ${orgId}, ${options.trigger}
      FROM (${source}) AS s
      RETURNING id, request_id, endpoint_id`);
    const list = [...inserted];
    const o = options.override;
    if (o && list.length > 0) {
      await tx.insert(schema.deliveryOverride).values(
        list.map((r) => ({
          deliveryId: r.id,
          method: o.method,
          path: o.path,
          query: o.query,
          headers: o.headers,
          body: o.body ? Buffer.from(o.body) : null,
        })),
      );
    }
    await enqueueDeliveries(
      tx,
      list.map((r) => r.id),
    );
    return list;
  });
  if (rows.length === 0) return [];

  const requestIds = [...new Set(rows.map((r) => r.request_id))];
  const statuses = await db
    .select({
      requestId: dlv.requestId,
      statuses: sql<DeliveryStatus[]>`array_agg(${dlv.status} ORDER BY ${dlv.createdAt})`,
    })
    .from(dlv)
    .where(inArray(dlv.requestId, requestIds))
    .groupBy(dlv.requestId);
  const byRequest = new Map(statuses.map((s) => [s.requestId, s.statuses]));
  await Promise.all(
    rows.map((r) =>
      publishEndpointEvent(r.endpoint_id, "delivery", {
        request_id: r.request_id,
        delivery_id: r.id,
        status: "pending",
        statuses: byRequest.get(r.request_id) ?? ["pending"],
      }),
    ),
  );
  return rows.map((r) => r.id);
}
