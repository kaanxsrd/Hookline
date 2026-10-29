import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { json } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";

/** Revokes the API key that makes the call (`hookline logout`). */
export const POST = apiRoute(null, async ({ request, caller: { db, key, org } }) => {
  await db.update(schema.apiKey).set({ revokedAt: new Date() }).where(eq(schema.apiKey.id, key.id));
  await writeAudit(db, {
    orgId: org.id,
    actorApiKeyId: key.id,
    action: "api_key.revoked",
    targetType: "api_key",
    targetId: key.id,
    metadata: { prefix: key.prefix, via: "cli_logout" },
    ip: clientIp(request.headers),
  });
  return json({ revoked: true });
});
