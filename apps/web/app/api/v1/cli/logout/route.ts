import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { authenticate, json } from "@/lib/api/http";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";

/** Revokes the API key that makes the call (`hookline logout`). */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { db, key, org } = auth.caller;
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
}
