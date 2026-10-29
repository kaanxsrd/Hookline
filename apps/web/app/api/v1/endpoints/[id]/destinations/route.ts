import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { findEndpoint } from "@/lib/api/endpoints";
import { ApiError, json, notFound, readJson } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import {
  createDestination,
  DestinationError,
  destinationJson,
  fromApiFields,
  settingsSchema,
} from "@/lib/destinations";

type Params = { id: string };

/** The endpoint's destinations, oldest first. */
export const GET = apiRoute<Params>("endpoints:read", async ({ caller: { db, org }, params }) => {
  const endpoint = await findEndpoint(db, org.id, params.id);
  if (!endpoint) throw notFound("endpoint");
  const rows = await db
    .select()
    .from(schema.destination)
    .where(eq(schema.destination.endpointId, endpoint.id))
    .orderBy(schema.destination.createdAt);
  return json({ data: rows.map(destinationJson) });
});

const body = z.preprocess(fromApiFields, settingsSchema);

/** Adds a destination; the Standard Webhooks secret is returned once. */
export const POST = apiRoute<Params>(
  "destinations:write",
  async ({ request, caller: { db, org, key }, params }) => {
    const input = await readJson(request, body);
    const endpoint = await findEndpoint(db, org.id, params.id);
    if (!endpoint) throw notFound("endpoint");
    try {
      const { id, signingSecret } = await createDestination(db, org.id, endpoint.id, input);
      await writeAudit(db, {
        orgId: org.id,
        actorApiKeyId: key.id,
        action: "destination.create",
        targetType: "destination",
        targetId: id,
        metadata: { endpoint: endpoint.slug, name: input.name, url: input.url },
        ip: clientIp(request.headers),
      });
      const [row] = await db.select().from(schema.destination).where(eq(schema.destination.id, id));
      if (!row) throw notFound("destination");
      return json({ ...destinationJson(row), signing_secret: signingSecret }, 201, {
        Location: `/api/v1/destinations/${id}`,
      });
    } catch (error) {
      if (error instanceof DestinationError) {
        throw new ApiError(
          error.code === "plan_limit" ? 403 : error.code === "not_found" ? 404 : 400,
          error.code,
          error.message,
        );
      }
      throw error;
    }
  },
);
