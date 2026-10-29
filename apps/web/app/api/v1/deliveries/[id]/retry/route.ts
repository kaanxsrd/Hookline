import { schema } from "@hookline/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError, json } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import { insertDeliveries } from "@/lib/deliveries";

const d = schema.delivery;
const r = schema.request;

/** Sends a delivery's request to its destination again, as a new manual delivery. */
export const POST = apiRoute<{ id: string }>(
  "requests:replay",
  async ({ request, caller: { db, org, key }, params }) => {
    if (!z.uuid().safeParse(params.id).success)
      throw new ApiError(404, "not_found", "Delivery not found.");
    const where = and(eq(d.id, params.id), eq(d.orgId, org.id));
    const [row] = await db
      .select({
        exists: sql<boolean>`EXISTS (SELECT 1 FROM ${r} WHERE ${r.id} = ${d.requestId} AND ${r.receivedAt} = ${d.requestReceivedAt})`,
      })
      .from(d)
      .where(where);
    if (!row) throw new ApiError(404, "not_found", "Delivery not found.");
    if (!row.exists) {
      throw new ApiError(409, "request_gone", "The request was deleted or is past its retention.");
    }
    const [id] = await insertDeliveries(
      db,
      org.id,
      sql`SELECT ${d.requestId} AS request_id, ${d.requestReceivedAt} AS request_received_at,
        ${d.destinationId} AS destination_id, ${d.endpointId} AS endpoint_id FROM ${d} WHERE ${where}`,
      { trigger: "manual" },
    );
    await writeAudit(db, {
      orgId: org.id,
      actorApiKeyId: key.id,
      action: "delivery.retry",
      targetType: "delivery",
      targetId: params.id,
      metadata: { retry: id },
      ip: clientIp(request.headers),
    });
    return json({ delivery_id: id }, 202);
  },
);
