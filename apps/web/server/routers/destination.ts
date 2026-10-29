import "server-only";
import { type Db, schema, uuidv7 } from "@hookline/db";
import type { DestinationFilter } from "@hookline/db/schema";
import { TRPCError } from "@trpc/server";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { checkDestinationUrl } from "@/lib/destination-url";
import { env } from "@/lib/env";
import { orgPlan } from "@/lib/plans";
import { destinationSigningContext, newSigningSecret, openSecret, sealSecret } from "@/lib/secrets";
import { orgProcedure, router } from "../trpc/init";
import { insertManualDeliveries } from "./delivery";
import { orgEndpoint } from "./request";

const dst = schema.destination;
const dlv = schema.delivery;

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

const filterSchema = z.object({
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

const settingsSchema = z.object({
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

/** Drops empty filter parts so `{}` means "everything". */
function normalizeFilter(f: z.infer<typeof filterSchema>): DestinationFilter {
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
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
}

/** A destination of the caller's organization, with its endpoint, or NOT_FOUND. */
async function ownedDestination(ctx: { db: Db; org: { id: string } }, id: string) {
  const [row] = await ctx.db
    .select({ destination: dst, endpointSlug: schema.endpoint.slug })
    .from(dst)
    .innerJoin(schema.endpoint, eq(schema.endpoint.id, dst.endpointId))
    .where(and(eq(dst.id, id), eq(schema.endpoint.orgId, ctx.org.id)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found." });
  return row;
}

function sealFor(id: string, secret: string) {
  return sealSecret(secret, destinationSigningContext(id));
}

export const destinationRouter = router({
  /** An endpoint's destinations with delivery health over the last 7 days. */
  list: orgProcedure.input(z.object({ endpointSlug: z.string() })).query(async ({ ctx, input }) => {
    const endpoint = await orgEndpoint(ctx, input.endpointSlug);
    const { limits } = await orgPlan(ctx.db, ctx.org.id);
    const rows = await ctx.db
      .select()
      .from(dst)
      .where(eq(dst.endpointId, endpoint.id))
      .orderBy(dst.createdAt);
    const stats = await ctx.db
      .select({
        destinationId: dlv.destinationId,
        total: count(),
        succeeded: sql<number>`count(*) FILTER (WHERE ${dlv.status} = 'succeeded')::int`,
        failed: sql<number>`count(*) FILTER (WHERE ${dlv.status} = 'failed')::int`,
        pending: sql<number>`count(*) FILTER (WHERE ${dlv.status} = 'pending')::int`,
        lastAt: sql<Date | null>`max(${dlv.createdAt})`,
      })
      .from(dlv)
      .where(
        and(eq(dlv.endpointId, endpoint.id), gte(dlv.createdAt, sql`now() - interval '7 days'`)),
      )
      .groupBy(dlv.destinationId);
    const byId = new Map(stats.map((s) => [s.destinationId, s]));
    return {
      limit: limits.destinations_per_endpoint,
      destinations: rows.map((d) => {
        const s = byId.get(d.id);
        const finished = (s?.succeeded ?? 0) + (s?.failed ?? 0);
        return {
          id: d.id,
          name: d.name,
          url: d.url,
          enabled: d.enabled,
          filter: d.filter,
          extraHeaders: d.extraHeaders,
          timeoutMs: d.timeoutMs,
          maxAttempts: d.maxAttempts,
          signWithStandardWebhooks: d.signWithStandardWebhooks,
          hasSigningSecret: d.signingSecretEnc !== null,
          createdAt: d.createdAt,
          stats: {
            total: s?.total ?? 0,
            succeeded: s?.succeeded ?? 0,
            failed: s?.failed ?? 0,
            pending: s?.pending ?? 0,
            successRate: finished > 0 ? (s?.succeeded ?? 0) / finished : null,
            lastAt: s?.lastAt ? new Date(s.lastAt) : null,
          },
        };
      }),
    };
  }),

  create: orgProcedure
    .meta({ role: "member" })
    .input(settingsSchema.extend({ endpointSlug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const endpoint = await orgEndpoint(ctx, input.endpointSlug);
      const { limits, plan } = await orgPlan(ctx.db, ctx.org.id);
      const [existing] = await ctx.db
        .select({ n: count() })
        .from(dst)
        .where(eq(dst.endpointId, endpoint.id));
      const max = limits.destinations_per_endpoint;
      if (max !== null && (existing?.n ?? 0) >= max) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `The ${plan} plan allows ${max} destination${max === 1 ? "" : "s"} per endpoint.`,
        });
      }
      await assertUrl(input.url);

      // The ID is part of the secret's associated data, so it exists before the row.
      const id = uuidv7();
      const secret = input.signWithStandardWebhooks ? newSigningSecret() : null;
      await ctx.db.insert(dst).values({
        id,
        endpointId: endpoint.id,
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
      ctx.audit({
        type: "destination",
        id,
        metadata: { endpoint: endpoint.slug, name: input.name, url: input.url },
      });
      return { id, signingSecret: secret };
    }),

  update: orgProcedure
    .meta({ role: "member" })
    .input(settingsSchema.partial().extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { destination: current, endpointSlug } = await ownedDestination(ctx, input.id);
      if (input.url !== undefined && input.url !== current.url) await assertUrl(input.url);

      let signingSecret: string | null = null;
      let signingSecretEnc = current.signingSecretEnc;
      if (input.signWithStandardWebhooks && !signingSecretEnc) {
        signingSecret = newSigningSecret();
        signingSecretEnc = sealFor(current.id, signingSecret);
      }
      const { id: _id, filter, ...rest } = input;
      await ctx.db
        .update(dst)
        .set({
          ...rest,
          ...(filter !== undefined ? { filter: normalizeFilter(filter) } : {}),
          signingSecretEnc,
        })
        .where(eq(dst.id, current.id));
      ctx.audit({
        type: "destination",
        id: current.id,
        metadata: {
          endpoint: endpointSlug,
          changed: Object.keys(rest).concat(filter !== undefined ? ["filter"] : []),
        },
      });
      return { ok: true, signingSecret };
    }),

  delete: orgProcedure
    .meta({ role: "member" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { destination: current, endpointSlug } = await ownedDestination(ctx, input.id);
      // Deliveries and their attempts cascade.
      await ctx.db.delete(dst).where(eq(dst.id, current.id));
      ctx.audit({
        type: "destination",
        id: current.id,
        metadata: { endpoint: endpointSlug, name: current.name, url: current.url },
      });
      return { ok: true };
    }),

  /** The Standard Webhooks signing secret, for configuring the receiver. Audited. */
  revealSecret: orgProcedure
    .meta({ role: "member", audit: "destination.secret_revealed" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { destination: current } = await ownedDestination(ctx, input.id);
      if (!current.signingSecretEnc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This destination has no signing secret.",
        });
      }
      ctx.audit({ type: "destination", id: current.id });
      return {
        secret: openSecret(current.signingSecretEnc, destinationSigningContext(current.id)),
      };
    }),

  /** Replaces the signing secret; deliveries from now on use the new one. */
  rotateSecret: orgProcedure
    .meta({ role: "member" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { destination: current } = await ownedDestination(ctx, input.id);
      const secret = newSigningSecret();
      await ctx.db
        .update(dst)
        .set({ signingSecretEnc: sealFor(current.id, secret) })
        .where(eq(dst.id, current.id));
      ctx.audit({ type: "destination", id: current.id });
      return { secret };
    }),

  /** Delivers the endpoint's most recent request to this destination now. */
  sendTest: orgProcedure
    .meta({ role: "member" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { destination: current } = await ownedDestination(ctx, input.id);
      const r = schema.request;
      const [deliveryId] = await insertManualDeliveries(
        ctx.db,
        ctx.org.id,
        sql`SELECT ${r.id} AS request_id, ${r.receivedAt} AS request_received_at,
            ${current.id}::uuid AS destination_id, ${r.endpointId} AS endpoint_id
          FROM ${r} WHERE ${r.endpointId} = ${current.endpointId}
          ORDER BY ${r.receivedAt} DESC LIMIT 1`,
      );
      if (!deliveryId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Send a request to the endpoint first; the test forwards the latest one.",
        });
      }
      ctx.audit({ type: "destination", id: current.id, metadata: { delivery: deliveryId } });
      return { deliveryId };
    }),
});
