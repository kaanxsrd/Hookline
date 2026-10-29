import "server-only";
import { type Db, schema } from "@hookline/db";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { API_KEY_PREFIX, type ApiScope } from "../api-keys";
import { getDb } from "../db";
import { sha256 } from "../random";

/** JSON response for the public API. Never cached, never sniffed. */
export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

/** Error body shared by every /api/v1 route: { error: { code, message } }. */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({ error: { code, message, ...extra } }, status);
}

/** Parses a JSON body with schema, or returns a 400/415 response. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return { response: apiError(415, "unsupported_media_type", "Send a JSON body.") };
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: apiError(400, "invalid_json", "The body is not valid JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      response: apiError(400, "invalid_request", "The request body is invalid.", {
        fields: z.flattenError(parsed.error).fieldErrors,
      }),
    };
  }
  return { data: parsed.data };
}

export type ApiCaller = {
  db: Db;
  key: { id: string; name: string; prefix: string; scopes: string[]; createdBy: string | null };
  org: { id: string; slug: string; name: string };
};

/**
 * Authenticates "Authorization: Bearer hk_live_..." and checks a scope.
 * Returns the caller or an error response (401 or 403).
 */
export async function authenticate(
  request: Request,
  scope?: ApiScope,
): Promise<{ caller: ApiCaller } | { response: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const unauthorized = apiError(
    401,
    "unauthorized",
    "Send a valid API key as `Authorization: Bearer hk_live_...`.",
  );
  if (!token.startsWith(API_KEY_PREFIX) || token.length > API_KEY_PREFIX.length + 64) {
    return { response: unauthorized };
  }
  const db = getDb();
  const k = schema.apiKey;
  const [row] = await db
    .select({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      createdBy: k.createdBy,
      lastUsedAt: k.lastUsedAt,
      orgId: schema.organization.id,
      orgSlug: schema.organization.slug,
      orgName: schema.organization.name,
    })
    .from(k)
    .innerJoin(schema.organization, eq(schema.organization.id, k.orgId))
    .where(
      and(
        eq(k.hash, sha256(token)),
        isNull(k.revokedAt),
        or(isNull(k.expiresAt), gt(k.expiresAt, new Date())),
      ),
    );
  if (!row) return { response: unauthorized };
  if (scope && !row.scopes.includes(scope)) {
    return {
      response: apiError(403, "insufficient_scope", `This API key lacks the ${scope} scope.`, {
        required_scope: scope,
      }),
    };
  }
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    // Informational and best effort, at most once a minute.
    void db
      .update(k)
      .set({ lastUsedAt: new Date() })
      .where(eq(k.id, row.id))
      .catch(() => {});
  }
  return {
    caller: {
      db,
      key: {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        createdBy: row.createdBy,
      },
      org: { id: row.orgId, slug: row.orgSlug, name: row.orgName },
    },
  };
}
