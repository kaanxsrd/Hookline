import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { findEndpoint } from "@/lib/api/endpoints";
import { apiError, authenticate, json } from "@/lib/api/http";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import { endpointSignatureContext, openSecret } from "@/lib/secrets";

type Params = { params: Promise<{ id: string }> };

/**
 * The endpoint's signature provider and secret, so `hookline trigger` can
 * sign sample events that verify. Needs endpoints:write; audited.
 */
export async function GET(request: Request, { params }: Params) {
  const auth = await authenticate(request, "endpoints:write");
  if ("response" in auth) return auth.response;
  const { db, org, key } = auth.caller;
  const ep = await findEndpoint(db, org.id, (await params).id);
  if (!ep) return apiError(404, "not_found", "No such endpoint in this organization.");
  const [row] = await db
    .select({
      provider: schema.endpoint.signatureProvider,
      enc: schema.endpoint.signatureSecretEnc,
    })
    .from(schema.endpoint)
    .where(eq(schema.endpoint.id, ep.id));
  if (!row?.provider || !row.enc) {
    return apiError(
      404,
      "not_configured",
      "This endpoint has no signature verification configured.",
    );
  }
  await writeAudit(db, {
    orgId: org.id,
    actorApiKeyId: key.id,
    action: "endpoint.signature_secret_read",
    targetType: "endpoint",
    targetId: ep.id,
    metadata: { slug: ep.slug },
    ip: clientIp(request.headers),
  });
  return json({
    provider: row.provider,
    secret: openSecret(row.enc, endpointSignatureContext(ep.id)),
  });
}
