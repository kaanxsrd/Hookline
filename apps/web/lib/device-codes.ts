import "server-only";
import { type Db, schema } from "@hookline/db";
import { and, count, eq, gt, gte, sql } from "drizzle-orm";
import { API_SCOPES, createApiKey } from "./api-keys";
import { newToken, sha256 } from "./random";

/**
 * OAuth 2.0 device authorization (RFC 8628) for `hookline login`.
 *
 * The CLI asks for a code pair, shows the user code and opens
 * /cli/authorize; the signed-in user picks an organization and approves.
 * The CLI polls with the device code and receives a new API key exactly once.
 */

export const DEVICE_CODE_TTL_SECONDS = 600;
export const POLL_INTERVAL_SECONDS = 5;
/** Most codes one address may request per hour. */
export const CODES_PER_IP_PER_HOUR = 20;

// RFC 8628 §6.1: consonants only, so codes never spell words and are easy to read aloud.
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

export function newUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  // 256 is not a multiple of 20; the bias (< 0.1 bit) is irrelevant for a 10-minute code.
  const chars = Array.from(bytes, (b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Accepts "abcd efgh", "ABCDEFGH" or "ABCD-EFGH". */
export function normalizeUserCode(input: string): string | null {
  const letters = input.toUpperCase().replace(/[^A-Z]/g, "");
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : null;
}

const d = schema.cliDeviceCode;

export async function requestDeviceCode(
  db: Db,
  input: { clientName: string | null; ip: string | null },
): Promise<
  | { ok: true; deviceCode: string; userCode: string; expiresIn: number }
  | { ok: false; reason: "rate_limited" }
> {
  if (input.ip) {
    const [recent] = await db
      .select({ n: count() })
      .from(d)
      .where(and(eq(d.clientIp, input.ip), gte(d.createdAt, sql`now() - interval '1 hour'`)));
    if ((recent?.n ?? 0) >= CODES_PER_IP_PER_HOUR) return { ok: false, reason: "rate_limited" };
  }
  const deviceCode = newToken();
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = newUserCode();
    const [row] = await db
      .insert(d)
      .values({
        deviceCodeHash: sha256(deviceCode),
        userCode,
        clientName: input.clientName,
        clientIp: input.ip,
        expiresAt: sql`now() + make_interval(secs => ${DEVICE_CODE_TTL_SECONDS})`,
      })
      .onConflictDoNothing({ target: d.userCode })
      .returning({ id: d.id });
    if (row) return { ok: true, deviceCode, userCode, expiresIn: DEVICE_CODE_TTL_SECONDS };
  }
  throw new Error("could not allocate a user code");
}

export type PollResult =
  | {
      status:
        | "authorization_pending"
        | "slow_down"
        | "access_denied"
        | "expired_token"
        | "invalid_grant";
    }
  | {
      status: "approved";
      apiKey: string;
      keyPrefix: string;
      org: { id: string; slug: string; name: string };
      user: { email: string; name: string };
    };

/** One poll by the CLI. Issues the API key on the first poll after approval. */
export async function pollDeviceCode(db: Db, deviceCode: string): Promise<PollResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: d.id,
        status: d.status,
        orgId: d.orgId,
        userId: d.userId,
        clientName: d.clientName,
        expired: sql<boolean>`${d.expiresAt} <= now()`,
        tooSoon: sql<boolean>`coalesce(${d.lastPolledAt} > now() - make_interval(secs => ${POLL_INTERVAL_SECONDS - 1}), false)`,
      })
      .from(d)
      .where(eq(d.deviceCodeHash, sha256(deviceCode)))
      .for("update");
    if (!row) return { status: "invalid_grant" };
    if (row.status === "consumed") return { status: "invalid_grant" };
    if (row.expired) return { status: "expired_token" };
    await tx.update(d).set({ lastPolledAt: sql`now()` }).where(eq(d.id, row.id));
    if (row.tooSoon) return { status: "slow_down" };
    if (row.status === "denied") return { status: "access_denied" };
    if (row.status === "pending" || !row.orgId || !row.userId) {
      return { status: "authorization_pending" };
    }

    const [ctx] = await tx
      .select({
        orgSlug: schema.organization.slug,
        orgName: schema.organization.name,
        email: schema.user.email,
        name: schema.user.name,
        isMember: sql<boolean>`EXISTS (
          SELECT 1 FROM ${schema.member} m WHERE m.organization_id = ${row.orgId} AND m.user_id = ${row.userId}
        )`,
      })
      .from(schema.organization)
      .innerJoin(schema.user, eq(schema.user.id, row.userId))
      .where(eq(schema.organization.id, row.orgId));
    // Membership may have ended between approval and this poll.
    if (!ctx?.isMember) return { status: "access_denied" };

    const key = await createApiKey(tx, {
      orgId: row.orgId,
      createdBy: row.userId,
      name: `CLI${row.clientName ? ` on ${row.clientName}` : ""}`.slice(0, 100),
      scopes: API_SCOPES,
    });
    await tx.update(d).set({ status: "consumed", apiKeyId: key.id }).where(eq(d.id, row.id));
    await tx.insert(schema.auditLog).values({
      orgId: row.orgId,
      actorUserId: row.userId,
      action: "api_key.created",
      targetType: "api_key",
      targetId: key.id,
      metadata: { prefix: key.prefix, via: "cli_login", client: row.clientName },
    });
    return {
      status: "approved",
      apiKey: key.key,
      keyPrefix: key.prefix,
      org: { id: row.orgId, slug: ctx.orgSlug, name: ctx.orgName },
      user: { email: ctx.email, name: ctx.name },
    };
  });
}

/** A pending, unexpired code by its user code. */
export async function findPendingCode(db: Db, userCode: string) {
  const [row] = await db
    .select({ id: d.id, clientName: d.clientName, createdAt: d.createdAt, expiresAt: d.expiresAt })
    .from(d)
    .where(and(eq(d.userCode, userCode), eq(d.status, "pending"), gt(d.expiresAt, sql`now()`)));
  return row ?? null;
}
