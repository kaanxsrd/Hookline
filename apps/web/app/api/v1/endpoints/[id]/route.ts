import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { endpointColumns, endpointJson, findEndpoint } from "@/lib/api/endpoints";
import { ApiError, json, notFound, readJson } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import { orgPlan } from "@/lib/plans";
import { invalidateEndpointCache, publishEndpointEvent } from "@/lib/redis";

type Params = { id: string };
const e = schema.endpoint;

/** One endpoint, by ID or slug. */
export const GET = apiRoute<Params>("endpoints:read", async ({ caller: { db, org }, params }) => {
  const row = await findEndpoint(db, org.id, params.id);
  if (!row) throw notFound("endpoint");
  return json(endpointJson(row));
});

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
    status: z.enum(["active", "paused"]),
    retention_hours: z.number().int().min(1),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to change");

/** Changes name, description, status or retention. */
export const PATCH = apiRoute<Params>(
  "endpoints:write",
  async ({ request, caller: { db, org, key }, params }) => {
    const input = await readJson(request, patchBody);
    const row = await findEndpoint(db, org.id, params.id);
    if (!row) throw notFound("endpoint");
    if (input.status && row.status === "disabled_by_admin") {
      throw new ApiError(
        403,
        "endpoint_disabled",
        "This endpoint was disabled by an administrator.",
      );
    }
    if (input.retention_hours !== undefined) {
      const { limits, plan } = await orgPlan(db, org.id);
      if (input.retention_hours > limits.retention_hours) {
        throw new ApiError(
          403,
          "plan_limit",
          `The ${plan} plan keeps requests for up to ${limits.retention_hours} hours.`,
        );
      }
    }
    const changes = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.retention_hours !== undefined ? { retentionHours: input.retention_hours } : {}),
    };
    await db.update(e).set(changes).where(eq(e.id, row.id));
    await invalidateEndpointCache(row.slug);
    if (input.status)
      await publishEndpointEvent(row.id, "endpoint", { id: row.id, status: input.status });
    await writeAudit(db, {
      orgId: org.id,
      actorApiKeyId: key.id,
      action: "endpoint.update",
      targetType: "endpoint",
      targetId: row.id,
      metadata: { slug: row.slug, ...input },
      ip: clientIp(request.headers),
    });
    const [updated] = await db.select(endpointColumns).from(e).where(eq(e.id, row.id));
    if (!updated) throw notFound("endpoint");
    return json(endpointJson(updated));
  },
);

/** Deletes an endpoint with its requests, destinations and deliveries. */
export const DELETE = apiRoute<Params>(
  "endpoints:write",
  async ({ request, caller: { db, org, key }, params }) => {
    const row = await findEndpoint(db, org.id, params.id);
    if (!row) throw notFound("endpoint");
    await db.delete(e).where(eq(e.id, row.id));
    await invalidateEndpointCache(row.slug);
    await writeAudit(db, {
      orgId: org.id,
      actorApiKeyId: key.id,
      action: "endpoint.delete",
      targetType: "endpoint",
      targetId: row.id,
      metadata: { slug: row.slug, name: row.name },
      ip: clientIp(request.headers),
    });
    return new Response(null, { status: 204 });
  },
);
