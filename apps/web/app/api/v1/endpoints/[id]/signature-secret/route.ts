import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { findEndpoint } from "@/lib/api/endpoints";
import { ApiError, json, notFound } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import { endpointSignatureContext, openSecret } from "@/lib/secrets";

/**
 * The endpoint's signature provider and secret, so `hookline trigger` can
 * sign sample events that verify. Needs endpoints:write; audited.
 */
export const GET = apiRoute<{ id: string }>(
  "endpoints:write",
  async ({ request, caller: { db, org, key }, params }) => {
    const ep = await findEndpoint(db, org.id, params.id);
    if (!ep) throw notFound("endpoint");
    const [row] = await db
      .select({
        provider: schema.endpoint.signatureProvider,
        enc: schema.endpoint.signatureSecretEnc,
      })
      .from(schema.endpoint)
      .where(eq(schema.endpoint.id, ep.id));
    if (!row?.provider || !row.enc) {
      throw new ApiError(
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
  },
);
