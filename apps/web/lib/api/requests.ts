import "server-only";
import { type Db, schema } from "@hookline/db";
import { and, eq, type SQL } from "drizzle-orm";
import { receivedAround } from "../requests";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The endpoint a request of the organization belongs to. */
export async function requestEndpoint(db: Db, orgId: string, id: string) {
  if (!UUID.test(id)) return null;
  const r = schema.request;
  const [row] = await db
    .select({ id: schema.endpoint.id, slug: schema.endpoint.slug })
    .from(r)
    .innerJoin(schema.endpoint, eq(schema.endpoint.id, r.endpointId))
    .where(and(eq(r.id, id), eq(r.orgId, orgId), receivedAround(id)) as SQL);
  return row ?? null;
}
