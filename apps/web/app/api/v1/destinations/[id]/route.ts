import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError, json, readJson } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/client-ip";
import {
  changesSchema,
  DestinationError,
  destinationJson,
  findDestination,
  fromApiFields,
  updateDestination,
} from "@/lib/destinations";

type Params = { id: string };

function toApi(error: unknown): never {
  if (error instanceof DestinationError) {
    throw new ApiError(
      error.code === "not_found" ? 404 : error.code === "plan_limit" ? 403 : 400,
      error.code,
      error.message,
    );
  }
  throw error;
}

const UUID = z.uuid();

async function owned(db: Parameters<typeof findDestination>[0], orgId: string, id: string) {
  if (!UUID.safeParse(id).success) throw new ApiError(404, "not_found", "Destination not found.");
  return findDestination(db, orgId, id).catch(toApi);
}

const body = z.preprocess(
  fromApiFields,
  changesSchema
    .omit({ signWithStandardWebhooks: true })
    .strict()
    .refine((v) => Object.keys(v).length > 0, "Send at least one field to change"),
);

/** Changes a destination. */
export const PATCH = apiRoute<Params>(
  "destinations:write",
  async ({ request, caller: { db, org, key }, params }) => {
    const input = await readJson(request, body);
    const { destination, endpointSlug } = await owned(db, org.id, params.id);
    const { changed } = await updateDestination(db, destination, input).catch(toApi);
    await writeAudit(db, {
      orgId: org.id,
      actorApiKeyId: key.id,
      action: "destination.update",
      targetType: "destination",
      targetId: destination.id,
      metadata: { endpoint: endpointSlug, changed },
      ip: clientIp(request.headers),
    });
    const [row] = await db
      .select()
      .from(schema.destination)
      .where(eq(schema.destination.id, destination.id));
    if (!row) throw new ApiError(404, "not_found", "Destination not found.");
    return json(destinationJson(row));
  },
);

/** Deletes a destination and its deliveries. */
export const DELETE = apiRoute<Params>(
  "destinations:write",
  async ({ request, caller: { db, org, key }, params }) => {
    const { destination, endpointSlug } = await owned(db, org.id, params.id);
    await db.delete(schema.destination).where(eq(schema.destination.id, destination.id));
    await writeAudit(db, {
      orgId: org.id,
      actorApiKeyId: key.id,
      action: "destination.delete",
      targetType: "destination",
      targetId: destination.id,
      metadata: { endpoint: endpointSlug, name: destination.name, url: destination.url },
      ip: clientIp(request.headers),
    });
    return new Response(null, { status: 204 });
  },
);
