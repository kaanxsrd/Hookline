import "server-only";
import { type Db, schema, uuidv7 } from "@hookline/db";
import type { Pair } from "@hookline/db/schema";
import { isSensitiveHeader, MASKED_VALUE, type TunnelRequest } from "@hookline/shared";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type CapturedRequest, encodeQuery } from "./captured";
import { insertDeliveries, type RequestOverride } from "./deliveries";
import { getRedis } from "./redis";
import { receivedAround } from "./requests";

/** Largest edited body (matches delivery_override's check constraint). */
export const MAX_EDIT_BODY_BYTES = 1024 * 1024;
/** Largest body a tunnel frame carries (see docs/tunnel-protocol.md). */
export const MAX_TUNNEL_BODY_BYTES = 720 * 1024;

const headerName = z
  .string()
  .trim()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/, "Not a valid header name");
const headerValue = z
  .string()
  .max(8000)
  .regex(/^[^\r\n\0]*$/, "Header values cannot contain line breaks");

/** An edited request as the dashboard and the API submit it. */
export const editSchema = z.object({
  method: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,16}$/, "Not an HTTP method"),
  path: z
    .string()
    .trim()
    .max(2048)
    .regex(/^\/[^\s]*$/, "The path must start with / and contain no spaces"),
  /** Raw query string without "?". */
  query: z.string().max(8192).default(""),
  headers: z.array(z.tuple([headerName, headerValue])).max(100),
  /** UTF-8 text; use bodyBase64 for binary bodies. */
  body: z.string().optional(),
  bodyBase64: z.string().optional(),
});
export type Edit = z.infer<typeof editSchema>;

export class ReplayError extends Error {
  constructor(
    readonly code: "not_found" | "too_large" | "no_tunnel" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

function queryPairs(raw: string): Pair[] {
  if (!raw) return [];
  return raw.split("&").map((part) => {
    const [k = "", v = ""] = part.split("=", 2);
    const decode = (s: string) => {
      try {
        return decodeURIComponent(s.replaceAll("+", " "));
      } catch {
        return s;
      }
    };
    return [decode(k), decode(v)] as Pair;
  });
}

/**
 * Turns an edit into an override. Masked values ("••••••") that were left
 * unchanged get the captured value back, so secrets never have to reach the
 * browser to be replayed.
 */
export function resolveEdit(captured: CapturedRequest, edit: Edit): RequestOverride {
  const seen = new Map<string, number>();
  const headers = edit.headers.map(([name, value]): Pair => {
    const key = name.toLowerCase();
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    if (value === MASKED_VALUE && isSensitiveHeader(name)) {
      const originals = captured.headers.filter(([n]) => n.toLowerCase() === key);
      return [name, originals[nth]?.[1] ?? ""];
    }
    return [name, value];
  });

  let body: Uint8Array | null;
  if (edit.bodyBase64 !== undefined) body = Buffer.from(edit.bodyBase64, "base64");
  else if (edit.body !== undefined) body = new TextEncoder().encode(edit.body);
  else if (captured.bodyOmitted) {
    throw new ReplayError(
      "too_large",
      "The captured body is too large to edit. Replay it without editing.",
    );
  } else body = captured.body;
  if (body && body.byteLength > MAX_EDIT_BODY_BYTES) {
    throw new ReplayError("too_large", "Edited bodies are limited to 1 MiB.");
  }
  return {
    method: edit.method,
    path: edit.path,
    query: queryPairs(edit.query),
    headers,
    body: body && body.byteLength > 0 ? body : null,
  };
}

/** Sends a captured request (or its edit) to one of the endpoint's destinations. */
export async function replayToDestination(
  db: Db,
  input: {
    orgId: string;
    endpointId: string;
    requestId: string;
    destinationId: string;
    override?: RequestOverride;
  },
): Promise<string> {
  const [dest] = await db
    .select({ id: schema.destination.id })
    .from(schema.destination)
    .where(
      and(
        eq(schema.destination.id, input.destinationId),
        eq(schema.destination.endpointId, input.endpointId),
      ),
    );
  if (!dest) throw new ReplayError("not_found", "Destination not found.");
  const r = schema.request;
  const source = sql`SELECT ${r.id} AS request_id, ${r.receivedAt} AS request_received_at,
      ${input.destinationId}::uuid AS destination_id, ${r.endpointId} AS endpoint_id
    FROM ${r} WHERE ${and(eq(r.id, input.requestId), eq(r.endpointId, input.endpointId), receivedAround(input.requestId)) as SQL}`;
  const [id] = await insertDeliveries(db, input.orgId, source, {
    trigger: "replay",
    ...(input.override ? { override: input.override } : {}),
  });
  if (!id) throw new ReplayError("not_found", "Request not found.");
  return id;
}

/**
 * Pushes a captured request (or its edit) to every CLI tunnel listening on
 * the endpoint. Returns how many edge instances received it.
 */
export async function replayToCli(
  captured: CapturedRequest,
  override?: RequestOverride,
): Promise<number> {
  const req = override ?? {
    method: captured.method,
    path: captured.path,
    query: captured.query,
    headers: captured.headers,
    body: captured.body,
  };
  if (!override && captured.bodyOmitted) {
    throw new ReplayError("too_large", "The body is too large to send through a tunnel.");
  }
  const body = req.body ?? new Uint8Array();
  if (body.byteLength > MAX_TUNNEL_BODY_BYTES) {
    throw new ReplayError("too_large", "The body is too large to send through a tunnel.");
  }
  const frame: TunnelRequest = {
    type: "request",
    id: uuidv7(),
    endpoint_id: captured.endpointId,
    method: req.method,
    path: req.path,
    query: encodeQuery(req.query),
    headers: req.headers,
    body_b64: Buffer.from(body).toString("base64"),
    body_size: body.byteLength,
    received_at: captured.receivedAt.toISOString(),
    replay_of: captured.id,
  };
  const receivers = await getRedis().publish(
    `tunnel:ep:${captured.endpointId}`,
    JSON.stringify(frame),
  );
  if (receivers === 0) {
    throw new ReplayError(
      "no_tunnel",
      "No CLI is listening on this endpoint. Start `hookline listen` first.",
    );
  }
  return receivers;
}
