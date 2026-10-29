import type { BodyView } from "@/lib/body";

/** A captured request as announced on the live stream (no header values, no body). */
export type RequestSummary = {
  id: string;
  endpoint_id: string;
  method: string;
  path: string;
  content_type?: string;
  body_size: number;
  source_ip?: string;
  signature_status: "verified" | "invalid" | "unchecked";
  response_status: number;
  /** ISO 8601. */
  received_at: string;
};

/** Everything the detail panel shows. Sensitive header values arrive masked. */
export type RequestDetail = RequestSummary & {
  query: [string, string][];
  headers: [string, string][];
  user_agent: string | null;
  body: BodyView;
  body_in_storage: boolean;
};
