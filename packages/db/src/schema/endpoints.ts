import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { bytea, createdAt, id, type Pair, tstz, updatedAt } from "./columns";
import { endpointStatus, responseMode, signatureProvider, signatureStatus } from "./enums";

/** Requests with bodies up to this size store them inline; larger bodies go to S3. */
export const INLINE_BODY_MAX_BYTES = 64 * 1024;

export const endpoint = pgTable(
  "endpoint",
  {
    id: id(),
    /** Null for anonymous endpoints, which must have expiresAt. */
    orgId: uuid("org_id").references(() => organization.id, { onDelete: "cascade" }),
    /** 12 random base62 characters: the public, unguessable part of /h/<slug>. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: endpointStatus("status").notNull().default("active"),
    /** Why an administrator disabled the endpoint. */
    disabledReason: text("disabled_reason"),

    responseMode: responseMode("response_mode").notNull().default("static"),
    responseStatus: integer("response_status").notNull().default(200),
    responseHeaders: jsonb("response_headers").$type<Pair[]>().notNull().default(sql`'[]'::jsonb`),
    responseBody: text("response_body").notNull().default(""),
    responseDelayMs: integer("response_delay_ms").notNull().default(0),
    syncTimeoutMs: integer("sync_timeout_ms").notNull().default(10_000),

    /** Requests stay unchecked until a secret is set too (templates pick the provider first). */
    signatureProvider: signatureProvider("signature_provider"),
    /** AES-256-GCM envelope produced with DATA_ENCRYPTION_KEY (includes the key ID). */
    signatureSecretEnc: text("signature_secret_enc"),

    retentionHours: integer("retention_hours").notNull().default(24),

    /** SHA-256 of the anonymous creator's view token. */
    anonymousViewTokenHash: bytea("anonymous_view_token_hash"),
    /** Used to cap anonymous endpoints per IP per day. */
    anonymousCreatorIp: inet("anonymous_creator_ip"),
    expiresAt: tstz("expires_at"),

    /** Maintained asynchronously, never inside the intake transaction. */
    requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
    lastRequestAt: tstz("last_request_at"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("endpoint_org_id_idx").on(t.orgId, t.createdAt.desc()),
    index("endpoint_expires_at_idx").on(t.expiresAt).where(sql`${t.expiresAt} IS NOT NULL`),
    index("endpoint_anonymous_creator_ip_idx")
      .on(t.anonymousCreatorIp, t.createdAt)
      .where(sql`${t.orgId} IS NULL`),
    check("endpoint_slug_check", sql`${t.slug} ~ '^[0-9A-Za-z]{12}$'`),
    check("endpoint_owner_check", sql`${t.orgId} IS NOT NULL OR ${t.expiresAt} IS NOT NULL`),
    check("endpoint_response_status_check", sql`${t.responseStatus} BETWEEN 200 AND 599`),
    check("endpoint_response_delay_check", sql`${t.responseDelayMs} BETWEEN 0 AND 30000`),
    check("endpoint_sync_timeout_check", sql`${t.syncTimeoutMs} BETWEEN 1000 AND 30000`),
    check("endpoint_retention_check", sql`${t.retentionHours} >= 1`),
  ],
);

/**
 * A captured HTTP request.
 *
 * Partitioned by day on received_at (see migration 0002), so the primary key
 * must include received_at and retention can drop whole partitions. The
 * CREATE TABLE in migration 0001 is edited to add PARTITION BY, which Drizzle
 * cannot express. received_at doubles as the row's creation time.
 */
export const request = pgTable(
  "request",
  {
    id: uuid("id").notNull().default(sql`uuidv7()`),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoint.id, { onDelete: "cascade" }),
    /** Denormalized from the endpoint for org-wide queries; no foreign key. */
    orgId: uuid("org_id"),
    method: text("method").notNull(),
    /** Path after /h/<slug>, always starting with "/". */
    path: text("path").notNull(),
    query: jsonb("query").$type<Pair[]>().notNull().default(sql`'[]'::jsonb`),
    headers: jsonb("headers").$type<Pair[]>().notNull().default(sql`'[]'::jsonb`),
    contentType: text("content_type"),
    bodyInline: bytea("body_inline"),
    bodyS3Key: text("body_s3_key"),
    bodySize: integer("body_size").notNull().default(0),
    bodySha256: bytea("body_sha256"),
    sourceIp: inet("source_ip"),
    userAgent: text("user_agent"),
    signatureStatus: signatureStatus("signature_status").notNull().default("unchecked"),
    /** Status code Hookline sent back to the sender. */
    responseStatus: integer("response_status"),
    durationMs: real("duration_ms"),
  },
  (t) => [
    primaryKey({ name: "request_pkey", columns: [t.id, t.receivedAt] }),
    index("request_endpoint_received_idx").on(t.endpointId, t.receivedAt.desc(), t.id.desc()),
    check("request_body_location_check", sql`${t.bodyInline} IS NULL OR ${t.bodyS3Key} IS NULL`),
  ],
);
