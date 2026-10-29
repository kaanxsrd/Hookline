export type SignatureStatus = "verified" | "invalid" | "unchecked";
export type DeliveryStatus = "pending" | "succeeded" | "failed" | "cancelled";

/** A captured request as announced on the live stream (no header values, no body). */
export type RequestSummary = {
  id: string;
  endpoint_id: string;
  method: string;
  path: string;
  content_type?: string;
  body_size: number;
  source_ip?: string;
  signature_status: SignatureStatus;
  response_status: number;
  /** ISO 8601. */
  received_at: string;
  /** One entry per destination delivery; absent on fresh live events. */
  deliveries?: DeliveryStatus[];
};

export type DeliveryAttempt = {
  attempt_no: number;
  status_code: number | null;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  /** First 2 KiB of the destination's response, as text. */
  response_preview: string | null;
};

export type DeliveryDetail = {
  id: string;
  destination_name: string;
  destination_url: string;
  status: DeliveryStatus;
  trigger: "auto" | "replay" | "manual";
  attempt_count: number;
  next_attempt_at: string | null;
  created_at: string;
  attempts: DeliveryAttempt[];
};

/** Everything the detail panel shows. Sensitive header values arrive masked unless revealed. */
export type RequestDetail = RequestSummary & {
  /** The URL the sender called, with path and query. */
  url: string;
  query: [string, string][];
  headers: [string, string][];
  headers_masked: boolean;
  user_agent: string | null;
  body_sha256: string | null;
  duration_ms: number | null;
  body: {
    /** Base64 of the body, or of its first 64 KiB for large stored bodies. */
    base64: string;
    truncated: boolean;
    in_storage: boolean;
  } | null;
  deliveries_detail: DeliveryDetail[];
};

/** Unset and undefined both mean "no constraint". */
export type RequestFilter = {
  methods?: string[] | undefined;
  signature?: SignatureStatus[] | undefined;
  delivery?: ("pending" | "succeeded" | "failed" | "none")[] | undefined;
  /** ISO 8601 bounds. */
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
};

export type RequestPage = { items: RequestSummary[]; nextCursor: string | undefined };
