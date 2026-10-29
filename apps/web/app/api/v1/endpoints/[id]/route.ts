import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { endpointJson, findEndpoint } from "@/lib/api/endpoints";
import { apiError, authenticate, json } from "@/lib/api/http";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import { invalidateEndpointCache } from "@/lib/redis";

type Params = { params: Promise<{ id: string }> };

const notFound = () => apiError(404, "not_found", "No such endpoint in this organization.");

/** One endpoint, by ID or slug. */
export async function GET(request: Request, { params }: Params) {
  const auth = await authenticate(request, "endpoints:read");
  if ("response" in auth) return auth.response;
  const row = await findEndpoint(auth.caller.db, auth.caller.org.id, (await params).id);
  return row ? json(endpointJson(row)) : notFound();
}

/** Deletes an endpoint with its requests, destinations and deliveries. */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await authenticate(request, "endpoints:write");
  if ("response" in auth) return auth.response;
  const { db, org, key } = auth.caller;
  const row = await findEndpoint(db, org.id, (await params).id);
  if (!row) return notFound();
  await db.delete(schema.endpoint).where(eq(schema.endpoint.id, row.id));
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
}
