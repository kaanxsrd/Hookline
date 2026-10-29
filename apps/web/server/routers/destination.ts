import "server-only";
import { type Db, schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  createDestination,
  DestinationError,
  findDestination,
  settingsSchema,
  updateDestination,
} from "@/lib/destinations";
import { orgPlan } from "@/lib/plans";
import { destinationSigningContext, newSigningSecret, openSecret, sealSecret } from "@/lib/secrets";
import { orgProcedure, router } from "../trpc/init";
import { insertManualDeliveries } from "./delivery";
import { orgEndpoint } from "./request";

const dst = schema.destination;
const dlv = schema.delivery;

function toTrpc(error: unknown): never {
  if (error instanceof DestinationError) {
    throw new TRPCError({
      code:
        error.code === "not_found"
          ? "NOT_FOUND"
          : error.code === "plan_limit"
            ? "FORBIDDEN"
            : "BAD_REQUEST",
      message: error.message,
    });
  }
  throw error;
}

/** A destination of the caller's organization, with its endpoint, or NOT_FOUND. */
async function ownedDestination(ctx: { db: Db; org: { id: string } }, id: string) {
  try {
    return await findDestination(ctx.db, ctx.org.id, id);
  } catch (error) {
    toTrpc(error);
  }
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
      const { endpointSlug: _slug, ...settings } = input;
      const { id, signingSecret: secret } = await createDestination(
        ctx.db,
        ctx.org.id,
        endpoint.id,
        settings,
      ).catch(toTrpc);
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
      const { id: _id, orgSlug: _org, ...changes } = input;
      const { signingSecret, changed } = await updateDestination(ctx.db, current, changes).catch(
        toTrpc,
      );
      ctx.audit({
        type: "destination",
        id: current.id,
        metadata: {
          endpoint: endpointSlug,
          changed,
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
