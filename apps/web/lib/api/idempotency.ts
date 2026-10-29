import "server-only";
import { schema } from "@hookline/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { sha256 } from "../random";
import { type ApiCaller, ApiError, json } from "./http";

const k = schema.idempotencyKey;
const TTL_HOURS = 24;

/**
 * Runs a POST at most once per Idempotency-Key and organization for 24 hours.
 * The key is claimed before the handler runs, so a concurrent retry gets 409
 * instead of acting twice; a finished request is answered from storage. A
 * key reused for a different request (method, path or body) gets 422.
 * Server errors release the key so the client can retry.
 */
export async function idempotent(
  caller: ApiCaller,
  request: Request,
  key: string,
  run: () => Promise<Response>,
): Promise<Response> {
  if (key.length > 255) {
    throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must be 1–255 characters.");
  }
  const url = new URL(request.url);
  const body = await request.clone().text();
  const hash = sha256(`${request.method} ${url.pathname}${url.search}\n${body}`);
  const { db, org } = caller;

  // Expired keys are free again even before the worker's cleanup runs.
  await db.delete(k).where(and(eq(k.orgId, org.id), eq(k.key, key), lt(k.expiresAt, sql`now()`)));
  const [claimed] = await db
    .insert(k)
    .values({
      orgId: org.id,
      key,
      requestHash: hash,
      expiresAt: sql`now() + make_interval(hours => ${TTL_HOURS})`,
    })
    .onConflictDoNothing()
    .returning({ id: k.id });

  if (!claimed) {
    const [row] = await db
      .select({ hash: k.requestHash, status: k.responseStatus, response: k.response })
      .from(k)
      .where(and(eq(k.orgId, org.id), eq(k.key, key)));
    if (!row) throw new ApiError(409, "idempotency_key_in_progress", "Retry in a moment.");
    if (!Buffer.from(row.hash).equals(hash)) {
      throw new ApiError(
        422,
        "idempotency_key_reused",
        "This Idempotency-Key was used for a different request.",
      );
    }
    if (row.status === null) {
      throw new ApiError(
        409,
        "idempotency_key_in_progress",
        "A request with this Idempotency-Key is still being processed.",
      );
    }
    if (row.status === 204)
      return new Response(null, { status: 204, headers: { "Idempotent-Replayed": "true" } });
    return json(row.response, row.status, { "Idempotent-Replayed": "true" });
  }

  const release = () => db.delete(k).where(eq(k.id, claimed.id));
  let response: Response;
  try {
    response = await run();
  } catch (error) {
    await release();
    throw error;
  }
  if (response.status >= 500) {
    await release();
    return response;
  }
  const text = await response.clone().text();
  let stored: unknown = null;
  try {
    stored = text ? JSON.parse(text) : null;
  } catch {
    stored = null;
  }
  await db
    .update(k)
    .set({ responseStatus: response.status, response: stored })
    .where(eq(k.id, claimed.id));
  return response;
}
