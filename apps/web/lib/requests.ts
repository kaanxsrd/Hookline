import "server-only";
import { type Db, schema } from "@hookline/db";
import { isSensitiveHeader, MASKED_VALUE } from "@hookline/shared";
import { and, desc, eq, gte, inArray, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type {
  DeliveryDetail,
  DeliveryStatus,
  RequestDetail,
  RequestPage,
  RequestSummary,
} from "@/components/inbox/types";
import { intakeUrl } from "./env";
import { readBodyPrefix } from "./s3";

const r = schema.request;
const d = schema.delivery;

const lenientUtf8 = new TextDecoder("utf-8", { fatal: false });

/**
 * Bounds received_at around a request ID's UUIDv7 timestamp, so lookups by ID
 * touch one or two daily partitions instead of all of them.
 */
export function receivedAround(id: string): SQL {
  const ms = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
  return and(
    gte(r.receivedAt, new Date(ms - 60_000)),
    lte(r.receivedAt, new Date(ms + 60_000)),
  ) as SQL;
}

/** Largest body (or stored-body prefix) sent to the browser for viewing. */
const PREVIEW_BYTES = 64 * 1024;

export const requestFilterSchema = z.object({
  methods: z
    .array(z.string().regex(/^[A-Z]{1,16}$/))
    .max(16)
    .optional(),
  signature: z
    .array(z.enum(["verified", "invalid", "unchecked"]))
    .max(3)
    .optional(),
  delivery: z
    .array(z.enum(["pending", "succeeded", "failed", "none"]))
    .max(4)
    .optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  q: z.string().trim().max(200).optional(),
});

export const listInputSchema = requestFilterSchema.extend({
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export type ListInput = z.infer<typeof listInputSchema>;

/** The endpoint a request list belongs to. */
export type EndpointRef = { id: string; slug: string; createdAt?: Date };

const deliveriesAgg = sql<DeliveryStatus[] | null>`(
  SELECT array_agg(${d.status} ORDER BY ${d.createdAt}) FROM ${d} WHERE ${d.requestId} = ${r.id}
)`;

const summaryColumns = {
  id: r.id,
  endpointId: r.endpointId,
  method: r.method,
  path: r.path,
  contentType: r.contentType,
  bodySize: r.bodySize,
  sourceIp: r.sourceIp,
  signatureStatus: r.signatureStatus,
  responseStatus: r.responseStatus,
  receivedAt: r.receivedAt,
  deliveries: deliveriesAgg,
};

type SummaryRow = {
  id: string;
  endpointId: string;
  method: string;
  path: string;
  contentType: string | null;
  bodySize: number;
  sourceIp: string | null;
  signatureStatus: RequestSummary["signature_status"];
  responseStatus: number | null;
  receivedAt: Date;
  deliveries?: DeliveryStatus[] | null;
};

/** Same shape as the edge's live events, so initial and live rows render alike. */
export function toSummary(row: SummaryRow): RequestSummary {
  return {
    id: row.id,
    endpoint_id: row.endpointId,
    method: row.method,
    path: row.path,
    ...(row.contentType ? { content_type: row.contentType } : {}),
    body_size: row.bodySize,
    ...(row.sourceIp ? { source_ip: row.sourceIp } : {}),
    signature_status: row.signatureStatus,
    response_status: row.responseStatus ?? 0,
    received_at: row.receivedAt.toISOString(),
    deliveries: row.deliveries ?? [],
  };
}

/** Escapes LIKE wildcards in user input. */
function likeEscape(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/** Requests of one endpoint, newest first, filtered; the cursor is the last ID of the previous page. */
export async function listRequests(
  db: Db,
  endpoint: EndpointRef,
  input: ListInput,
): Promise<RequestPage> {
  const where: (SQL | undefined)[] = [eq(r.endpointId, endpoint.id)];
  if (endpoint.createdAt) where.push(gte(r.receivedAt, endpoint.createdAt));
  if (input.cursor) where.push(lt(r.id, input.cursor));
  if (input.methods?.length) where.push(inArray(r.method, input.methods));
  if (input.signature?.length) where.push(inArray(r.signatureStatus, input.signature));
  if (input.from) where.push(gte(r.receivedAt, new Date(input.from)));
  if (input.to) where.push(lte(r.receivedAt, new Date(input.to)));
  if (input.delivery?.length) {
    const statuses = input.delivery.filter((s) => s !== "none");
    const parts: SQL[] = [];
    if (statuses.length) {
      parts.push(
        sql`EXISTS (SELECT 1 FROM ${d} WHERE ${d.requestId} = ${r.id} AND ${inArray(d.status, statuses)})`,
      );
    }
    if (input.delivery.includes("none")) {
      parts.push(sql`NOT EXISTS (SELECT 1 FROM ${d} WHERE ${d.requestId} = ${r.id})`);
    }
    where.push(or(...parts));
  }
  if (input.q) {
    const term = `%${likeEscape(input.q)}%`;
    // The body clause matches the trigram index expression in migration 0002.
    where.push(
      or(
        sql`${r.path} ILIKE ${term}`,
        sql`(${r.bodyInline} IS NOT NULL AND encode(${r.bodyInline}, 'escape') ILIKE encode(convert_to(${term}, 'UTF8'), 'escape'))`,
      ),
    );
  }

  const rows = await db
    .select(summaryColumns)
    .from(r)
    .where(and(...where))
    .orderBy(desc(r.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > input.limit ? page.at(-1)?.id : undefined,
  };
}

function maskPairs(pairs: [string, string][]): { pairs: [string, string][]; masked: boolean } {
  let masked = false;
  const out = pairs.map(([name, value]): [string, string] => {
    if (!isSensitiveHeader(name)) return [name, value];
    masked = true;
    return [name, MASKED_VALUE];
  });
  return { pairs: out, masked };
}

async function loadDeliveries(db: Db, requestId: string): Promise<DeliveryDetail[]> {
  const deliveries = await db
    .select({
      id: d.id,
      status: d.status,
      trigger: d.trigger,
      attemptCount: d.attemptCount,
      nextAttemptAt: d.nextAttemptAt,
      createdAt: d.createdAt,
      destinationName: schema.destination.name,
      destinationUrl: schema.destination.url,
    })
    .from(d)
    .innerJoin(schema.destination, eq(schema.destination.id, d.destinationId))
    .where(eq(d.requestId, requestId))
    .orderBy(d.createdAt);
  if (deliveries.length === 0) return [];

  const a = schema.deliveryAttempt;
  const attempts = await db
    .select({
      deliveryId: a.deliveryId,
      attemptNo: a.attemptNo,
      statusCode: a.statusCode,
      error: a.error,
      durationMs: a.durationMs,
      startedAt: a.startedAt,
      preview: sql<Buffer | null>`substring(${a.responseBody} from 1 for 2048)`,
    })
    .from(a)
    .where(
      inArray(
        a.deliveryId,
        deliveries.map((x) => x.id),
      ),
    )
    .orderBy(a.attemptNo);

  return deliveries.map((x) => ({
    id: x.id,
    destination_name: x.destinationName,
    destination_url: x.destinationUrl,
    status: x.status,
    trigger: x.trigger,
    attempt_count: x.attemptCount,
    next_attempt_at: x.nextAttemptAt?.toISOString() ?? null,
    created_at: x.createdAt.toISOString(),
    attempts: attempts
      .filter((t) => t.deliveryId === x.id)
      .map((t) => ({
        attempt_no: t.attemptNo,
        status_code: t.statusCode,
        error: t.error,
        duration_ms: t.durationMs,
        started_at: t.startedAt.toISOString(),
        response_preview: t.preview ? lenientUtf8.decode(t.preview) : null,
      })),
  }));
}

/**
 * One request with headers masked unless `reveal`. Bodies over 64 KiB come
 * from object storage, truncated to their first 64 KiB.
 */
export async function getRequestDetail(
  db: Db,
  endpoint: EndpointRef,
  id: string,
  opts: { reveal: boolean },
): Promise<RequestDetail | null> {
  const [row] = await db
    .select({
      ...summaryColumns,
      query: r.query,
      headers: r.headers,
      userAgent: r.userAgent,
      bodyInline: r.bodyInline,
      bodyS3Key: r.bodyS3Key,
      bodySha256: r.bodySha256,
      durationMs: r.durationMs,
    })
    .from(r)
    .where(and(eq(r.id, id), eq(r.endpointId, endpoint.id), receivedAround(id)));
  if (!row) return null;

  let body: RequestDetail["body"] = null;
  if (row.bodyInline && row.bodyInline.length > 0) {
    body = {
      base64: Buffer.from(row.bodyInline.subarray(0, PREVIEW_BYTES)).toString("base64"),
      truncated: row.bodyInline.length > PREVIEW_BYTES,
      in_storage: false,
    };
  } else if (row.bodyS3Key) {
    const prefix = await readBodyPrefix(row.bodyS3Key, PREVIEW_BYTES).catch(() => null);
    body = {
      base64: prefix ? Buffer.from(prefix).toString("base64") : "",
      truncated: true,
      in_storage: true,
    };
  }

  const headers = opts.reveal ? { pairs: row.headers, masked: false } : maskPairs(row.headers);
  const query = row.query
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return {
    ...toSummary(row),
    url: `${intakeUrl(endpoint.slug)}${row.path === "/" ? "" : row.path}${query ? `?${query}` : ""}`,
    query: row.query,
    headers: headers.pairs,
    headers_masked: headers.masked,
    user_agent: row.userAgent,
    body_sha256: row.bodySha256 ? Buffer.from(row.bodySha256).toString("hex") : null,
    duration_ms: row.durationMs,
    body,
    deliveries_detail: await loadDeliveries(db, row.id),
  };
}

/** Body location for downloads. */
export async function getBodyRef(db: Db, endpoint: EndpointRef, id: string) {
  const [row] = await db
    .select({
      inline: r.bodyInline,
      key: r.bodyS3Key,
      contentType: r.contentType,
      size: r.bodySize,
    })
    .from(r)
    .where(and(eq(r.id, id), eq(r.endpointId, endpoint.id), receivedAround(id)));
  return row ?? null;
}

/** Deletes a request; its stored body is removed by the worker's orphan sweep. */
export async function deleteRequest(db: Db, endpoint: EndpointRef, id: string): Promise<boolean> {
  const deleted = await db
    .delete(r)
    .where(and(eq(r.id, id), eq(r.endpointId, endpoint.id), receivedAround(id)))
    .returning({ id: r.id });
  if (deleted.length > 0) await db.delete(d).where(eq(d.requestId, id));
  return deleted.length > 0;
}
