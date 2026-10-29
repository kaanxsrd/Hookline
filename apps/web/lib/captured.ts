import "server-only";
import { type Db, schema } from "@hookline/db";
import type { Pair } from "@hookline/db/schema";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { type EndpointRef, receivedAround } from "./requests";
import { readBodyPrefix } from "./s3";

const r = schema.request;

/** A captured request with its body, for verification, replay and the API. */
export type CapturedRequest = {
  id: string;
  endpointId: string;
  method: string;
  path: string;
  query: Pair[];
  headers: Pair[];
  contentType: string | null;
  bodySize: number;
  /** Null when there is no body or it is larger than the caller's limit. */
  body: Uint8Array | null;
  /** The body exists but was not loaded (over the limit or storage unavailable). */
  bodyOmitted: boolean;
  receivedAt: Date;
};

async function load(
  db: Db,
  where: SQL,
  maxBodyBytes: number,
  order = false,
): Promise<CapturedRequest | null> {
  const q = db
    .select({
      id: r.id,
      endpointId: r.endpointId,
      method: r.method,
      path: r.path,
      query: r.query,
      headers: r.headers,
      contentType: r.contentType,
      bodySize: r.bodySize,
      inline: r.bodyInline,
      key: r.bodyS3Key,
      receivedAt: r.receivedAt,
    })
    .from(r)
    .where(where);
  const [row] = await (order ? q.orderBy(desc(r.receivedAt)).limit(1) : q);
  if (!row) return null;
  let body: Uint8Array | null = row.inline ?? null;
  if (row.key && row.bodySize <= maxBodyBytes) body = await readBodyPrefix(row.key, maxBodyBytes);
  if (body && body.byteLength > maxBodyBytes) body = null;
  return {
    id: row.id,
    endpointId: row.endpointId,
    method: row.method,
    path: row.path,
    query: row.query,
    headers: row.headers,
    contentType: row.contentType,
    bodySize: row.bodySize,
    body,
    bodyOmitted: row.bodySize > 0 && body === null,
    receivedAt: row.receivedAt,
  };
}

/** One request of an endpoint by ID. */
export function loadCaptured(db: Db, endpoint: EndpointRef, id: string, maxBodyBytes: number) {
  return load(
    db,
    and(eq(r.id, id), eq(r.endpointId, endpoint.id), receivedAround(id)) as SQL,
    maxBodyBytes,
  );
}

/** The endpoint's most recent request. */
export function loadLatestCaptured(db: Db, endpoint: EndpointRef, maxBodyBytes: number) {
  return load(db, eq(r.endpointId, endpoint.id), maxBodyBytes, true);
}

/** Rebuilds a raw query string from stored pairs, keeping order. */
export function encodeQuery(pairs: Pair[]): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}
