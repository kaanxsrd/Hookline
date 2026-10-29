import { schema } from "@hookline/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { endpointColumns, endpointJson } from "@/lib/api/endpoints";
import { apiError, authenticate, json, readJson } from "@/lib/api/http";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import {
  checkEndpointQuota,
  ENDPOINT_TEMPLATES,
  insertEndpoint,
  QuotaError,
} from "@/lib/endpoints";

/** Lists the organization's endpoints, newest first. */
export async function GET(request: Request) {
  const auth = await authenticate(request, "endpoints:read");
  if ("response" in auth) return auth.response;
  const { db, org } = auth.caller;
  const rows = await db
    .select(endpointColumns)
    .from(schema.endpoint)
    .where(eq(schema.endpoint.orgId, org.id))
    .orderBy(desc(schema.endpoint.createdAt));
  return json({ data: rows.map(endpointJson) });
}

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  template: z.enum(ENDPOINT_TEMPLATES).default("generic"),
});

/** Creates an endpoint. */
export async function POST(request: Request) {
  const auth = await authenticate(request, "endpoints:write");
  if ("response" in auth) return auth.response;
  const parsed = await readJson(request, createBody);
  if ("response" in parsed) return parsed.response;
  const { db, org, key } = auth.caller;

  let limits: Awaited<ReturnType<typeof checkEndpointQuota>>;
  try {
    limits = await checkEndpointQuota(db, org.id);
  } catch (error) {
    if (error instanceof QuotaError) return apiError(403, "plan_limit", error.message);
    throw error;
  }
  const created = await insertEndpoint(db, org.id, limits, parsed.data);
  await writeAudit(db, {
    orgId: org.id,
    actorApiKeyId: key.id,
    action: "endpoint.create",
    targetType: "endpoint",
    targetId: created.id,
    metadata: { name: parsed.data.name, slug: created.slug, template: parsed.data.template },
    ip: clientIp(request.headers),
  });
  const [row] = await db
    .select(endpointColumns)
    .from(schema.endpoint)
    .where(eq(schema.endpoint.id, created.id));
  if (!row) throw new Error("created endpoint vanished");
  return json(endpointJson(row), 201, { Location: `/api/v1/endpoints/${created.id}` });
}
