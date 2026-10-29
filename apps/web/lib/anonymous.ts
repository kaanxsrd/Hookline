import "server-only";
import { schema } from "@hookline/db";
import { anonymousRules } from "@hookline/shared";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { matchesHash, newSlug, newToken, sha256 } from "./random";

/** httpOnly cookie remembering the visitor's anonymous endpoint as "<slug>.<token>". */
export const VISITOR_COOKIE = "hl_anon";

export type AnonymousEndpoint = {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  expiresAt: Date;
};

export function visitorCookieValue(slug: string, token: string): string {
  return `${slug}.${token}`;
}

export function parseVisitorCookie(
  value: string | undefined,
): { slug: string; token: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  return { slug: value.slice(0, dot), token: value.slice(dot + 1) };
}

/**
 * Returns the anonymous endpoint when token is its view token and it has not
 * expired. Unknown slug, wrong token and expiry are indistinguishable to the
 * caller, so the response never reveals whether a slug exists.
 */
export async function authorizeAnonymous(
  slug: string,
  token: string | undefined,
): Promise<AnonymousEndpoint | null> {
  if (!token || !/^[0-9A-Za-z]{12}$/.test(slug)) return null;
  const e = schema.endpoint;
  const [row] = await getDb()
    .select({
      id: e.id,
      slug: e.slug,
      name: e.name,
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
      tokenHash: e.anonymousViewTokenHash,
    })
    .from(e)
    .where(and(eq(e.slug, slug), isNull(e.orgId)));
  if (!row?.expiresAt || row.expiresAt <= new Date()) return null;
  if (!matchesHash(token, row.tokenHash)) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export type CreateResult =
  | { ok: true; slug: string; token: string; expiresAt: Date }
  | { ok: false; error: string };

/** Creates an anonymous endpoint for a visitor, enforcing the per-IP daily cap. */
export async function createAnonymousEndpoint(ip: string | null): Promise<CreateResult> {
  const db = getDb();
  const e = schema.endpoint;

  if (ip) {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [recent] = await db
      .select({ n: count() })
      .from(e)
      .where(and(isNull(e.orgId), eq(e.anonymousCreatorIp, ip), gt(e.createdAt, since)));
    if ((recent?.n ?? 0) >= anonymousRules.endpoints_per_ip_per_day) {
      return {
        ok: false,
        error: `You have created ${anonymousRules.endpoints_per_ip_per_day} temporary endpoints today. Sign up for a free account to create more.`,
      };
    }
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + anonymousRules.expiry_hours * 3_600_000);
  // A collision in 62^12 slugs is astronomically unlikely; retry anyway.
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = newSlug();
    const [row] = await db
      .insert(e)
      .values({
        slug,
        name: "Temporary endpoint",
        description: "Created without an account. Sign up to keep it.",
        expiresAt,
        retentionHours: anonymousRules.expiry_hours,
        anonymousViewTokenHash: sha256(token),
        anonymousCreatorIp: ip,
      })
      .onConflictDoNothing({ target: e.slug })
      .returning({ slug: e.slug });
    if (row) return { ok: true, slug: row.slug, token, expiresAt };
  }
  return { ok: false, error: "Could not create an endpoint. Please try again." };
}
