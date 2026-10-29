import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { bytea, createdAt, id, tstz, updatedAt } from "./columns";
import { deviceCodeStatus, plan } from "./enums";

/**
 * API keys look like hk_live_<32 random bytes, base62>. Only the SHA-256 hash
 * and a short prefix (for display) are stored.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hash: bytea("hash").notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    lastUsedAt: tstz("last_used_at"),
    expiresAt: tstz("expires_at"),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("api_key_hash_idx").on(t.hash),
    index("api_key_org_id_idx").on(t.orgId),
    check(
      "api_key_scopes_check",
      sql`${t.scopes} <@ ARRAY['endpoints:read', 'endpoints:write', 'requests:read', 'requests:replay', 'tunnel', 'destinations:write']::text[]`,
    ),
  ],
);

/** OAuth-style device authorization for `hookline login` (RFC 8628). */
export const cliDeviceCode = pgTable(
  "cli_device_code",
  {
    id: id(),
    deviceCodeHash: bytea("device_code_hash").notNull(),
    /** Shown to the user as ABCD-EFGH. */
    userCode: text("user_code").notNull(),
    status: deviceCodeStatus("status").notNull().default("pending"),
    orgId: uuid("org_id").references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id").references(() => apiKey.id, { onDelete: "set null" }),
    /** Shown on the approval page so users can recognise the device. */
    clientName: text("client_name"),
    clientIp: inet("client_ip"),
    /** Polls faster than the interval get slow_down. */
    lastPolledAt: tstz("last_polled_at"),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("cli_device_code_hash_idx").on(t.deviceCodeHash),
    uniqueIndex("cli_device_code_user_code_idx").on(t.userCode),
    check("cli_device_code_user_code_check", sql`${t.userCode} ~ '^[A-Z]{4}-[A-Z]{4}$'`),
  ],
);

/** Append-only record of security-relevant actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    /** Null for instance-level (admin) actions. */
    orgId: uuid("org_id").references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorApiKeyId: uuid("actor_api_key_id").references(() => apiKey.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ip: inet("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("audit_log_action_idx").on(t.orgId, t.action),
  ],
);

export const usageDaily = pgTable(
  "usage_daily",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    deliveries: bigint("deliveries", { mode: "number" }).notNull().default(0),
    tunnelMinutes: bigint("tunnel_minutes", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: "usage_daily_pkey", columns: [t.orgId, t.day] })],
);

/** One row per organization. Stripe columns stay null until billing is configured. */
export const subscription = pgTable(
  "subscription",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    plan: plan("plan").notNull().default("free"),
    /** Set by an instance administrator; wins over plan. */
    planOverride: plan("plan_override"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** Stripe subscription status (active, past_due, canceled, ...), or "none". */
    status: text("status").notNull().default("none"),
    currentPeriodEnd: tstz("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subscription_org_id_idx").on(t.orgId),
    uniqueIndex("subscription_stripe_customer_idx").on(t.stripeCustomerId),
    uniqueIndex("subscription_stripe_subscription_idx").on(t.stripeSubscriptionId),
  ],
);

/**
 * Stored responses for Idempotency-Key. A row with a null response is a
 * request still in flight; a concurrent retry gets 409.
 */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** SHA-256 of method, path and body; a reused key with a different request is rejected. */
    requestHash: bytea("request_hash").notNull(),
    responseStatus: integer("response_status"),
    response: jsonb("response"),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("idempotency_key_org_key_idx").on(t.orgId, t.key),
    index("idempotency_key_expires_at_idx").on(t.expiresAt),
  ],
);
