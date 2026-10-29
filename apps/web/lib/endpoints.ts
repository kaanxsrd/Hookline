import "server-only";
import { type Db, schema } from "@hookline/db";
import type { Pair } from "@hookline/db/schema";
import type { Limits } from "@hookline/shared";
import { count, eq } from "drizzle-orm";
import { orgPlan } from "./plans";
import { newSlug } from "./random";

const e = schema.endpoint;

export const ENDPOINT_TEMPLATES = ["generic", "stripe", "github", "shopify", "discord"] as const;
export type EndpointTemplate = (typeof ENDPOINT_TEMPLATES)[number];

/** Default responses that keep each provider happy. Signature checks are configured separately. */
const templateResponses: Record<
  EndpointTemplate,
  { status: number; headers: Pair[]; body: string }
> = {
  generic: { status: 200, headers: [], body: "" },
  stripe: {
    status: 200,
    headers: [["Content-Type", "application/json"]],
    body: '{"received":true}',
  },
  github: { status: 202, headers: [], body: "" },
  shopify: { status: 200, headers: [], body: "" },
  // Discord interactions expect a PONG ({"type":1}) to their PING.
  discord: { status: 200, headers: [["Content-Type", "application/json"]], body: '{"type":1}' },
};

/** A plan limit stopped the action; the message is shown to the user. */
export class QuotaError extends Error {}

/** The organization's limits, or QuotaError when it cannot create another endpoint. */
export async function checkEndpointQuota(db: Db, orgId: string): Promise<Limits> {
  const { limits, plan } = await orgPlan(db, orgId);
  if (limits.endpoints === null) return limits;
  const [existing] = await db.select({ n: count() }).from(e).where(eq(e.orgId, orgId));
  if ((existing?.n ?? 0) >= limits.endpoints) {
    throw new QuotaError(
      `The ${plan} plan includes ${limits.endpoints} endpoints. Delete one or upgrade to create more.`,
    );
  }
  return limits;
}

/** Creates an endpoint with a fresh unguessable slug. Check the quota first. */
export async function insertEndpoint(
  db: Db,
  orgId: string,
  limits: Limits,
  input: { name: string; description: string; template: EndpointTemplate },
): Promise<{ id: string; slug: string }> {
  const response = templateResponses[input.template];
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .insert(e)
      .values({
        orgId,
        slug: newSlug(),
        name: input.name,
        description: input.description,
        responseStatus: response.status,
        responseHeaders: response.headers,
        responseBody: response.body,
        retentionHours: limits.retention_hours,
      })
      .onConflictDoNothing({ target: e.slug })
      .returning({ id: e.id, slug: e.slug });
    if (row) return row;
  }
  throw new Error("could not allocate an endpoint slug");
}
