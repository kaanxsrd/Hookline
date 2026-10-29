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

/** The one error shape of /api/v1: { error: { code, message, details? } }. */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  headers: HeadersInit = {},
): Response {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, status, headers);
}

/** Thrown inside handlers to answer with an API error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) =>
  new ApiError(404, "not_found", `No such ${what} in this organization.`);

/** Parses a JSON body with schema; throws ApiError (400/415) otherwise. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Send a JSON body with Content-Type: application/json.",
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The body is not valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "The request body is invalid.", {
      fields: z.flattenError(parsed.error).fieldErrors,
    });
  }
  return parsed.data;
}

/** Parses query parameters with schema; throws ApiError (400) otherwise. */
export function readQuery<T extends z.ZodType>(request: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "The query parameters are invalid.", {
      fields: z.flattenError(parsed.error).fieldErrors,
    });
  }
  return parsed.data;
}

/** ?cursor=&limit= for list endpoints. */
export const pageQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Splits rows fetched with limit + 1 into a page and its next cursor. */
export function page<T extends { id: string }>(rows: T[], limit: number) {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  return { data, next_cursor: more ? (data.at(-1)?.id ?? null) : null };
}

export type ApiCaller = {
  db: Db;
  key: { id: string; name: string; prefix: string; scopes: string[]; createdBy: string | null };
  org: { id: string; slug: string; name: string };
};

/**
 * Authenticates "Authorization: Bearer hk_live_..." and checks a scope.
 * Throws ApiError 401 or 403.
 */
export async function authenticate(request: Request, scope?: ApiScope): Promise<ApiCaller> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const unauthorized = new ApiError(
    401,
    "unauthorized",
    "Send a valid API key as `Authorization: Bearer hk_live_...`.",
  );
  if (!token.startsWith(API_KEY_PREFIX) || token.length > API_KEY_PREFIX.length + 64)
    throw unauthorized;
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
  if (!row) throw unauthorized;
  if (scope && !row.scopes.includes(scope)) {
    throw new ApiError(403, "insufficient_scope", `This API key lacks the ${scope} scope.`, {
      required_scope: scope,
    });
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
    db,
    key: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes,
      createdBy: row.createdBy,
    },
    org: { id: row.orgId, slug: row.orgSlug, name: row.orgName },
  };
}
