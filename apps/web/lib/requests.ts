import "server-only";
import { schema } from "@hookline/db";
import { maskHeaders } from "@hookline/shared";
import type { RequestDetail, RequestSummary } from "@/components/inbox/types";
import { describeBody } from "./body";

const r = schema.request;

/** Columns needed for a list row. */
export const summaryColumns = {
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
};

/** Columns needed for the detail panel. */
export const detailColumns = {
  ...summaryColumns,
  query: r.query,
  headers: r.headers,
  userAgent: r.userAgent,
  bodyInline: r.bodyInline,
  bodyS3Key: r.bodyS3Key,
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
};

type DetailRow = SummaryRow & {
  query: [string, string][];
  headers: [string, string][];
  userAgent: string | null;
  bodyInline: Uint8Array | null;
  bodyS3Key: string | null;
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
  };
}

/** Sensitive header values are masked here, before anything reaches the browser. */
export function toDetail(row: DetailRow): RequestDetail {
  return {
    ...toSummary(row),
    query: row.query,
    headers: maskHeaders(row.headers),
    user_agent: row.userAgent,
    body: row.bodyS3Key ? { kind: "empty" } : describeBody(row.bodyInline, row.contentType),
    body_in_storage: row.bodyS3Key !== null,
  };
}
