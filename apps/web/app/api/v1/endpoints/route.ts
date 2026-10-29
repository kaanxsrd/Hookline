import { schema } from "@hookline/db";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { endpointColumns, endpointJson } from "@/lib/api/endpoints";
import { ApiError, json, page, pageQuery, readJson, readQuery } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import {
  checkEndpointQuota,
  ENDPOINT_TEMPLATES,
  insertEndpoint,
  QuotaError,
} from "@/lib/endpoints";

const e = schema.endpoint;

/** Lists the organization's endpoints, newest first. */
export const GET = apiRoute("endpoints:read", async ({ request, caller: { db, org } }) => {
  const q = readQuery(request, pageQuery);
  const rows = await db
    .select(endpointColumns)
    .from(e)
    .where(and(eq(e.orgId, org.id), q.cursor ? lt(e.id, q.cursor) : undefined))
    .orderBy(desc(e.id))
    .limit(q.limit + 1);
  const p = page(rows, q.limit);
  return json({ data: p.data.map(endpointJson), next_cursor: p.next_cursor });
});

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  template: z.enum(ENDPOINT_TEMPLATES).default("generic"),
});

/** Creates an endpoint. */
export const POST = apiRoute("endpoints:write", async ({ request, caller: { db, org, key } }) => {
  const input = await readJson(request, createBody);
  let limits: Awaited<ReturnType<typeof checkEndpointQuota>>;
  try {
    limits = await checkEndpointQuota(db, org.id);
  } catch (error) {
    if (error instanceof QuotaError) throw new ApiError(403, "plan_limit", error.message);
    throw error;
  }
  const created = await insertEndpoint(db, org.id, limits, input);
  await writeAudit(db, {
    orgId: org.id,
    actorApiKeyId: key.id,
    action: "endpoint.create",
    targetType: "endpoint",
    targetId: created.id,
    metadata: { name: input.name, slug: created.slug, template: input.template },
    ip: clientIp(request.headers),
  });
  const [row] = await db.select(endpointColumns).from(e).where(eq(e.id, created.id));
  if (!row) throw new Error("created endpoint vanished");
  return json(endpointJson(row), 201, { Location: `/api/v1/endpoints/${created.id}` });
});
