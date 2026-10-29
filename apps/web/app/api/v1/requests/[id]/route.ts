import { schema } from "@hookline/db";
import { and, eq, type SQL } from "drizzle-orm";
import { json, notFound } from "@/lib/api/http";
import { requestEndpoint } from "@/lib/api/requests";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { loadCaptured } from "@/lib/captured";
import { clientIp } from "@/lib/client-ip";
import { deleteRequest, receivedAround } from "@/lib/requests";

type Params = { id: string };
/** Bodies up to this size are included; larger ones are fetched from /body. */
const MAX_INLINE_BODY = 10 * 1024 * 1024;

/** One captured request with headers (unmasked) and body. */
export const GET = apiRoute<Params>("requests:read", async ({ caller: { db, org }, params }) => {
  const endpoint = await requestEndpoint(db, org.id, params.id);
  const captured = endpoint && (await loadCaptured(db, endpoint, params.id, MAX_INLINE_BODY));
  if (!endpoint || !captured) throw notFound("request");
  const [meta] = await db
    .select({ signatureStatus: schema.request.signatureStatus })
    .from(schema.request)
    .where(and(eq(schema.request.id, captured.id), receivedAround(captured.id)) as SQL);
  return json({
    id: captured.id,
    endpoint: { id: endpoint.id, slug: endpoint.slug },
    method: captured.method,
    path: captured.path,
    query: captured.query,
    headers: captured.headers,
    content_type: captured.contentType,
    body_size: captured.bodySize,
    body_b64: captured.body ? Buffer.from(captured.body).toString("base64") : null,
    body_omitted: captured.bodyOmitted,
    signature_status: meta?.signatureStatus ?? "unchecked",
    received_at: captured.receivedAt,
  });
});

/** Deletes a captured request. */
export const DELETE = apiRoute<Params>(
  "endpoints:write",
  async ({ request, caller: { db, org, key }, params }) => {
    const endpoint = await requestEndpoint(db, org.id, params.id);
    if (!endpoint || !(await deleteRequest(db, endpoint, params.id))) throw notFound("request");
    await writeAudit(db, {
      orgId: org.id,
      actorApiKeyId: key.id,
      action: "request.delete",
      targetType: "request",
      targetId: params.id,
      metadata: { endpoint: endpoint.slug },
      ip: clientIp(request.headers),
    });
    return new Response(null, { status: 204 });
  },
);
