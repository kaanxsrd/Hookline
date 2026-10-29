import "server-only";
import { type Db, schema, uuidv7 } from "@hookline/db";
import type { DestinationFilter } from "@hookline/db/schema";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { checkDestinationUrl } from "./destination-url";
import { env } from "./env";
import { orgPlan } from "./plans";
import { destinationSigningContext, newSigningSecret, sealSecret } from "./secrets";

const dst = schema.destination;

/** Header names a destination may not set: they describe the connection or are Hookline's own. */
const RESERVED_HEADERS =
  /^(host|content-length|transfer-encoding|connection|keep-alive|upgrade|te|trailer|proxy-.*|x-hookline-.*|webhook-(id|timestamp|signature))$/i;

const headerName = z
  .string()
  .trim()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/, "Not a valid header name")
  .refine((n) => !RESERVED_HEADERS.test(n), "Hookline sets this header itself");
const headerValue = z
  .string()
  .max(4000)
  .regex(/^[^\r\n\0]*$/, "Header values cannot contain line breaks");

export const filterSchema = z.object({
  methods: z
    .array(z.string().regex(/^[A-Z]{1,16}$/))
    .max(16)
    .optional(),
  header_equals: z.record(headerName, headerValue).optional(),
  json_path_equals: z
    .record(
      z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^(\$\.?)?[^\s]+$/, "Use a path such as data.object.status"),
      z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
});

export const settingsSchema = z.object({
  name: z.string().trim().min(1, "Give the destination a name").max(80),
  url: z.string().trim().max(2048),
  enabled: z.boolean().default(true),
  filter: filterSchema.default({}),
  extraHeaders: z
    .array(z.tuple([headerName, headerValue]))
    .max(20)
    .default([]),
  timeoutMs: z.number().int().min(1000).max(30_000).default(10_000),
  maxAttempts: z.number().int().min(1).max(20).default(8),
  signWithStandardWebhooks: z.boolean().default(false),
});
export type DestinationSettings = z.infer<typeof settingsSchema>;
export const changesSchema = settingsSchema.partial();
export type DestinationChanges = z.infer<typeof changesSchema>;

/** A rule stopped the change; `code` maps to HTTP/tRPC errors. */
export class DestinationError extends Error {
  constructor(
    readonly code: "not_found" | "plan_limit" | "invalid_url",
    message: string,
  ) {
    super(message);
  }
}

/** Drops empty filter parts so `{}` means "everything". */
export function normalizeFilter(f: z.infer<typeof filterSchema>): DestinationFilter {
  return {
    ...(f.methods?.length ? { methods: f.methods } : {}),
    ...(f.header_equals && Object.keys(f.header_equals).length
      ? { header_equals: f.header_equals }
      : {}),
    ...(f.json_path_equals && Object.keys(f.json_path_equals).length
      ? { json_path_equals: f.json_path_equals }
      : {}),
  };
}

async function assertUrl(url: string) {
  const problem = await checkDestinationUrl(url, {
    allowPrivate: env().ALLOW_PRIVATE_DESTINATIONS,
  });
  if (problem) throw new DestinationError("invalid_url", problem);
}

function sealFor(id: string, secret: string) {
  return sealSecret(secret, destinationSigningContext(id));
}

/** A destination of the organization, with its endpoint's slug. */
export async function findDestination(db: Db, orgId: string, id: string) {
  const [row] = await db
    .select({ destination: dst, endpointSlug: schema.endpoint.slug })
    .from(dst)
    .innerJoin(schema.endpoint, eq(schema.endpoint.id, dst.endpointId))
    .where(and(eq(dst.id, id), eq(schema.endpoint.orgId, orgId)));
  if (!row) throw new DestinationError("not_found", "Destination not found.");
  return row;
}

/** Adds a destination within the plan's limit. Returns the new signing secret, once. */
export async function createDestination(
  db: Db,
  orgId: string,
  endpointId: string,
  input: DestinationSettings,
): Promise<{ id: string; signingSecret: string | null }> {
  const { limits, plan } = await orgPlan(db, orgId);
  const [existing] = await db
    .select({ n: count() })
    .from(dst)
    .where(eq(dst.endpointId, endpointId));
  const max = limits.destinations_per_endpoint;
  if (max !== null && (existing?.n ?? 0) >= max) {
    throw new DestinationError(
      "plan_limit",
      `The ${plan} plan allows ${max} destination${max === 1 ? "" : "s"} per endpoint.`,
    );
  }
  await assertUrl(input.url);
  // The ID is part of the secret's associated data, so it exists before the row.
  const id = uuidv7();
  const secret = input.signWithStandardWebhooks ? newSigningSecret() : null;
  await db.insert(dst).values({
    id,
    endpointId,
    name: input.name,
    url: input.url,
    enabled: input.enabled,
    filter: normalizeFilter(input.filter),
    extraHeaders: input.extraHeaders,
    timeoutMs: input.timeoutMs,
    maxAttempts: input.maxAttempts,
    signWithStandardWebhooks: input.signWithStandardWebhooks,
    signingSecretEnc: secret ? sealFor(id, secret) : null,
  });
  return { id, signingSecret: secret };
}

/** Applies the fields given. Turning signing on creates a secret, returned once. */
export async function updateDestination(
  db: Db,
  current: typeof dst.$inferSelect,
  changes: DestinationChanges,
): Promise<{ signingSecret: string | null; changed: string[] }> {
  if (changes.url !== undefined && changes.url !== current.url) await assertUrl(changes.url);
  let signingSecret: string | null = null;
  let signingSecretEnc = current.signingSecretEnc;
  if (changes.signWithStandardWebhooks && !signingSecretEnc) {
    signingSecret = newSigningSecret();
    signingSecretEnc = sealFor(current.id, signingSecret);
  }
  const { filter, ...rest } = changes;
  await db
    .update(dst)
    .set({
      ...rest,
      ...(filter !== undefined ? { filter: normalizeFilter(filter) } : {}),
      signingSecretEnc,
    })
    .where(eq(dst.id, current.id));
  return {
    signingSecret,
    changed: Object.keys(rest).concat(filter !== undefined ? ["filter"] : []),
  };
}

const API_FIELDS: Record<string, string> = {
  extra_headers: "extraHeaders",
  timeout_ms: "timeoutMs",
  max_attempts: "maxAttempts",
  sign_with_standard_webhooks: "signWithStandardWebhooks",
};

/** Renames the API's snake_case fields to the settings schema's names. */
export function fromApiFields(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [API_FIELDS[k] ?? k, v]));
}

/** The public representation (api/openapi.yaml Destination). */
export function destinationJson(d: typeof dst.$inferSelect) {
  return {
    id: d.id,
    endpoint_id: d.endpointId,
    name: d.name,
    url: d.url,
    enabled: d.enabled,
    filter: d.filter,
    extra_headers: d.extraHeaders,
    timeout_ms: d.timeoutMs,
    max_attempts: d.maxAttempts,
    sign_with_standard_webhooks: d.signWithStandardWebhooks,
    created_at: d.createdAt,
  };
}
