import "server-only";
import { schema } from "@hookline/db";
import type { Pair } from "@hookline/db/schema";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { authorizeAnonymous, parseVisitorCookie, VISITOR_COOKIE } from "@/lib/anonymous";
import { intakeUrl } from "@/lib/env";
import { orgPlan } from "@/lib/plans";
import { newSlug } from "@/lib/random";
import { invalidateEndpointCache, publishEndpointEvent } from "@/lib/redis";
import { orgProcedure, router } from "../trpc/init";

const e = schema.endpoint;

export const ENDPOINT_TEMPLATES = ["generic", "stripe", "github", "shopify", "discord"] as const;
export type EndpointTemplate = (typeof ENDPOINT_TEMPLATES)[number];

/** Default responses that keep each provider happy. Signature checks are configured separately. */
const templateResponses: Record<
  EndpointTemplate,
  { status: number; headers: Pair[]; body: string }
> = {
  generic: { status: 200, headers: [], body: "" },
  stripe: {
    status: 200,
    headers: [["Content-Type", "application/json"]],
    body: '{"received":true}',
  },
  github: { status: 202, headers: [], body: "" },
  shopify: { status: 200, headers: [], body: "" },
  // Discord interactions expect a PONG ({"type":1}) to their PING.
  discord: { status: 200, headers: [["Content-Type", "application/json"]], body: '{"type":1}' },
};

const slugInput = z.string().regex(/^[0-9A-Za-z]{12}$/, "Invalid endpoint");

/** Loads an endpoint of the caller's organization or fails with NOT_FOUND. */
async function ownedEndpoint(
  ctx: { db: import("@hookline/db").Db; org: { id: string } },
  slug: string,
) {
  const [row] = await ctx.db
    .select()
    .from(e)
    .where(and(eq(e.slug, slug), eq(e.orgId, ctx.org.id)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Endpoint not found." });
  return row;
}

async function assertEndpointQuota(ctx: { db: import("@hookline/db").Db; org: { id: string } }) {
  const { limits, plan } = await orgPlan(ctx.db, ctx.org.id);
  if (limits.endpoints === null) return limits;
  const [existing] = await ctx.db.select({ n: count() }).from(e).where(eq(e.orgId, ctx.org.id));
  if ((existing?.n ?? 0) >= limits.endpoints) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `The ${plan} plan includes ${limits.endpoints} endpoints. Delete one or upgrade to create more.`,
    });
  }
  return limits;
}

export const endpointRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: e.id,
        slug: e.slug,
        name: e.name,
        description: e.description,
        status: e.status,
        requestCount: e.requestCount,
        lastRequestAt: e.lastRequestAt,
        createdAt: e.createdAt,
      })
      .from(e)
      .where(eq(e.orgId, ctx.org.id))
      .orderBy(desc(e.createdAt));

    // Requests per hour over the last 24 hours, oldest bucket first.
    const buckets = await ctx.db
      .select({
        endpointId: schema.request.endpointId,
        hoursAgo: sql<number>`floor(extract(epoch from (now() - ${schema.request.receivedAt})) / 3600)::int`,
        n: count(),
      })
      .from(schema.request)
      .where(
        and(
          eq(schema.request.orgId, ctx.org.id),
          gte(schema.request.receivedAt, sql`now() - interval '24 hours'`),
        ),
      )
      .groupBy(sql`1, 2`);
    const sparklines = new Map<string, number[]>();
    for (const b of buckets) {
      const line = sparklines.get(b.endpointId) ?? Array.from({ length: 24 }, () => 0);
      const index = 23 - Math.min(23, Math.max(0, b.hoursAgo));
      line[index] = (line[index] ?? 0) + b.n;
      sparklines.set(b.endpointId, line);
    }
    return rows.map((r) => ({
      ...r,
      url: intakeUrl(r.slug),
      last24h: sparklines.get(r.id) ?? Array.from({ length: 24 }, () => 0),
    }));
  }),

  get: orgProcedure.input(z.object({ slug: slugInput })).query(async ({ ctx, input }) => {
    const row = await ownedEndpoint(ctx, input.slug);
    return {
      id: row.id,
      slug: row.slug,
      url: intakeUrl(row.slug),
      name: row.name,
      description: row.description,
      status: row.status,
      disabledReason: row.disabledReason,
      responseMode: row.responseMode,
      responseStatus: row.responseStatus,
      responseHeaders: row.responseHeaders,
      responseBody: row.responseBody,
      responseDelayMs: row.responseDelayMs,
      syncTimeoutMs: row.syncTimeoutMs,
      signatureProvider: row.signatureProvider,
      hasSignatureSecret: row.signatureSecretEnc !== null,
      retentionHours: row.retentionHours,
      requestCount: row.requestCount,
      lastRequestAt: row.lastRequestAt,
      createdAt: row.createdAt,
    };
  }),

  create: orgProcedure
    .meta({ role: "member" })
    .input(
      z.object({
        name: z.string().trim().min(1, "Give the endpoint a name").max(80),
        description: z.string().trim().max(500).default(""),
        template: z.enum(ENDPOINT_TEMPLATES).default("generic"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const limits = await assertEndpointQuota(ctx);
      const response = templateResponses[input.template];
      for (let attempt = 0; attempt < 3; attempt++) {
        const [row] = await ctx.db
          .insert(e)
          .values({
            orgId: ctx.org.id,
            slug: newSlug(),
            name: input.name,
            description: input.description,
            responseStatus: response.status,
            responseHeaders: response.headers,
            responseBody: response.body,
            retentionHours: limits.retention_hours,
          })
          .onConflictDoNothing({ target: e.slug })
          .returning({ id: e.id, slug: e.slug });
        if (row) {
          ctx.audit({
            type: "endpoint",
            id: row.id,
            metadata: { name: input.name, slug: row.slug, template: input.template },
          });
          return { ...row, url: intakeUrl(row.slug) };
        }
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not allocate a URL." });
    }),

  update: orgProcedure
    .meta({ role: "member" })
    .input(
      z.object({
        slug: slugInput,
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(500).optional(),
        status: z.enum(["active", "paused"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await ownedEndpoint(ctx, input.slug);
      if (input.status && current.status === "disabled_by_admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This endpoint was disabled by an administrator.",
        });
      }
      const changes = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      };
      if (Object.keys(changes).length === 0) return { ok: true };
      await ctx.db.update(e).set(changes).where(eq(e.id, current.id));
      await invalidateEndpointCache(current.slug);
      await publishEndpointEvent(current.id, "endpoint", { id: current.id, ...changes });
      ctx.audit({ type: "endpoint", id: current.id, metadata: { slug: current.slug, ...changes } });
      return { ok: true };
    }),

  delete: orgProcedure
    .meta({ role: "member" })
    .input(z.object({ slug: slugInput, confirm: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const current = await ownedEndpoint(ctx, input.slug);
      if (input.confirm !== current.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Type the endpoint's name to confirm.",
        });
      }
      // Requests, destinations and deliveries cascade; stored bodies are
      // removed by the worker's orphan sweep.
      await ctx.db.delete(e).where(eq(e.id, current.id));
      await invalidateEndpointCache(current.slug);
      ctx.audit({
        type: "endpoint",
        id: current.id,
        metadata: { slug: current.slug, name: current.name },
      });
      return { ok: true };
    }),

  /** Pauses or resumes several endpoints at once. */
  bulkUpdate: orgProcedure
    .meta({ role: "member", audit: "endpoint.bulk_status" })
    .input(
      z.object({ slugs: z.array(slugInput).min(1).max(100), status: z.enum(["active", "paused"]) }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(e)
        .set({ status: input.status })
        .where(
          and(
            eq(e.orgId, ctx.org.id),
            inArray(e.slug, input.slugs),
            ne(e.status, "disabled_by_admin"),
          ),
        )
        .returning({ id: e.id, slug: e.slug });
      for (const u of updated) {
        await invalidateEndpointCache(u.slug);
        await publishEndpointEvent(u.id, "endpoint", { id: u.id, status: input.status });
      }
      ctx.audit({
        type: "endpoint",
        metadata: { slugs: updated.map((u) => u.slug), status: input.status },
      });
      return { updated: updated.length };
    }),

  /** Deletes several endpoints; `confirm` must equal the number of endpoints. */
  bulkDelete: orgProcedure
    .meta({ role: "member", audit: "endpoint.bulk_deleted" })
    .input(z.object({ slugs: z.array(slugInput).min(1).max(100), confirm: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (input.confirm !== input.slugs.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirm the number of endpoints to delete.",
        });
      }
      const deleted = await ctx.db
        .delete(e)
        .where(and(eq(e.orgId, ctx.org.id), inArray(e.slug, input.slugs)))
        .returning({ id: e.id, slug: e.slug, name: e.name });
      for (const d of deleted) await invalidateEndpointCache(d.slug);
      ctx.audit({
        type: "endpoint",
        metadata: { endpoints: deleted.map((d) => ({ slug: d.slug, name: d.name })) },
      });
      return { deleted: deleted.length };
    }),

  /** Moves the visitor's temporary endpoint (proved by their cookie) into this organization. */
  claimAnonymous: orgProcedure
    .meta({ role: "member", audit: "endpoint.claimed" })
    .mutation(async ({ ctx }) => {
      const jar = await cookies();
      const visitor = parseVisitorCookie(jar.get(VISITOR_COOKIE)?.value);
      const anonymous = visitor && (await authorizeAnonymous(visitor.slug, visitor.token));
      if (!anonymous) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No temporary endpoint to keep." });
      }
      const limits = await assertEndpointQuota(ctx);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(e)
          .set({
            orgId: ctx.org.id,
            expiresAt: null,
            anonymousViewTokenHash: null,
            anonymousCreatorIp: null,
            retentionHours: limits.retention_hours,
            name: "Claimed endpoint",
            description: "",
          })
          .where(and(eq(e.id, anonymous.id), isNull(e.orgId)));
        await tx
          .update(schema.request)
          .set({ orgId: ctx.org.id })
          .where(eq(schema.request.endpointId, anonymous.id));
      });
      await invalidateEndpointCache(anonymous.slug);
      jar.delete(VISITOR_COOKIE);
      ctx.audit({ type: "endpoint", id: anonymous.id, metadata: { slug: anonymous.slug } });
      return { slug: anonymous.slug };
    }),
});
