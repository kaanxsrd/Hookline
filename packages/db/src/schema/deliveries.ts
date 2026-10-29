import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { bytea, createdAt, id, type Pair, tstz, updatedAt } from "./columns";
import { endpoint } from "./endpoints";
import { deliveryStatus, deliveryTrigger } from "./enums";

/** Which captured requests a destination receives. Every present condition must match. */
export type DestinationFilter = {
  methods?: string[];
  header_equals?: Record<string, string>;
  json_path_equals?: Record<string, string | number | boolean | null>;
};

export const destination = pgTable(
  "destination",
  {
    id: id(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoint.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    filter: jsonb("filter").$type<DestinationFilter>().notNull().default(sql`'{}'::jsonb`),
    extraHeaders: jsonb("extra_headers").$type<Pair[]>().notNull().default(sql`'[]'::jsonb`),
    timeoutMs: integer("timeout_ms").notNull().default(10_000),
    maxAttempts: integer("max_attempts").notNull().default(8),
    signWithStandardWebhooks: boolean("sign_with_standard_webhooks").notNull().default(false),
    /** AES-256-GCM envelope produced with DATA_ENCRYPTION_KEY (includes the key ID). */
    signingSecretEnc: text("signing_secret_enc"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("destination_endpoint_id_idx").on(t.endpointId),
    check("destination_url_check", sql`${t.url} ~* '^https?://'`),
    check("destination_timeout_check", sql`${t.timeoutMs} BETWEEN 1000 AND 30000`),
    check("destination_max_attempts_check", sql`${t.maxAttempts} BETWEEN 1 AND 20`),
    check(
      "destination_signing_check",
      sql`NOT ${t.signWithStandardWebhooks} OR ${t.signingSecretEnc} IS NOT NULL`,
    ),
  ],
);

/**
 * One request routed to one destination. request_id + request_received_at
 * locate the (partitioned) request row. There is deliberately no foreign key
 * to it: dropping a day partition must not be blocked by deliveries, which
 * retention deletes explicitly.
 */
export const delivery = pgTable(
  "delivery",
  {
    id: id(),
    requestId: uuid("request_id").notNull(),
    requestReceivedAt: tstz("request_received_at").notNull(),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoint.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organization.id, { onDelete: "cascade" }),
    status: deliveryStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: tstz("next_attempt_at"),
    lastStatusCode: integer("last_status_code"),
    trigger: deliveryTrigger("trigger").notNull().default("auto"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("delivery_request_idx").on(t.requestId),
    index("delivery_destination_created_idx").on(t.destinationId, t.createdAt.desc()),
    index("delivery_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("delivery_org_failed_idx")
      .on(t.orgId, t.createdAt.desc())
      .where(sql`${t.status} = 'failed'`),
  ],
);

/** Largest edited body a replay may carry. */
export const REPLAY_OVERRIDE_MAX_BODY_BYTES = 1024 * 1024;

/**
 * An edited request to send instead of the captured one ("edit & replay").
 * The captured request is never modified.
 */
export const deliveryOverride = pgTable(
  "delivery_override",
  {
    deliveryId: uuid("delivery_id")
      .primaryKey()
      .references(() => delivery.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    /** Below /h/{slug}, starting with "/". */
    path: text("path").notNull(),
    query: jsonb("query").$type<Pair[]>().notNull().default(sql`'[]'::jsonb`),
    headers: jsonb("headers").$type<Pair[]>().notNull().default(sql`'[]'::jsonb`),
    body: bytea("body"),
    createdAt: createdAt(),
  },
  (t) => [
    check("delivery_override_method_check", sql`${t.method} ~ '^[A-Z]{1,16}$'`),
    check("delivery_override_path_check", sql`${t.path} LIKE '/%'`),
    check(
      "delivery_override_body_check",
      sql`${t.body} IS NULL OR octet_length(${t.body}) <= ${sql.raw(String(REPLAY_OVERRIDE_MAX_BODY_BYTES))}`,
    ),
  ],
);

export const deliveryAttempt = pgTable(
  "delivery_attempt",
  {
    id: id(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => delivery.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    /** Null when no HTTP response arrived (network error, timeout, blocked address). */
    statusCode: integer("status_code"),
    error: text("error"),
    responseHeaders: jsonb("response_headers").$type<Pair[]>().notNull().default(sql`'[]'::jsonb`),
    /** First 64 KiB of the response body. */
    responseBody: bytea("response_body"),
    durationMs: real("duration_ms"),
    startedAt: tstz("started_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("delivery_attempt_delivery_no_idx").on(t.deliveryId, t.attemptNo)],
);
