import "server-only";
import { type Db, schema } from "@hookline/db";
import { and, eq, or, type SQL } from "drizzle-orm";
import { intakeUrl } from "../env";

const e = schema.endpoint;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Endpoints are addressed by ID or slug in /api/v1 paths. */
export function endpointRef(orgId: string, idOrSlug: string): SQL {
  const match = UUID.test(idOrSlug)
    ? or(eq(e.id, idOrSlug), eq(e.slug, idOrSlug))
    : eq(e.slug, idOrSlug);
  return and(eq(e.orgId, orgId), match) as SQL;
}

export const endpointColumns = {
  id: e.id,
  slug: e.slug,
  name: e.name,
  description: e.description,
  status: e.status,
  responseMode: e.responseMode,
  requestCount: e.requestCount,
  lastRequestAt: e.lastRequestAt,
  retentionHours: e.retentionHours,
  signatureProvider: e.signatureProvider,
  createdAt: e.createdAt,
};

type Row = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  responseMode: string;
  requestCount: number;
  lastRequestAt: Date | null;
  retentionHours: number;
  signatureProvider: string | null;
  createdAt: Date;
};

/** The public representation of an endpoint (snake_case, as in api/openapi.yaml). */
export function endpointJson(row: Row) {
  return {
    id: row.id,
    slug: row.slug,
    url: intakeUrl(row.slug),
    name: row.name,
    description: row.description,
    status: row.status,
    response_mode: row.responseMode,
    request_count: row.requestCount,
    last_request_at: row.lastRequestAt,
    retention_hours: row.retentionHours,
    signature_provider: row.signatureProvider,
    created_at: row.createdAt,
  };
}

export async function findEndpoint(db: Db, orgId: string, idOrSlug: string) {
  const [row] = await db.select(endpointColumns).from(e).where(endpointRef(orgId, idOrSlug));
  return row ?? null;
}
