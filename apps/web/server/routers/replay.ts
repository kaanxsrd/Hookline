import "server-only";
import { schema } from "@hookline/db";
import { maskHeaders } from "@hookline/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CapturedRequest, encodeQuery, loadCaptured } from "@/lib/captured";
import { tunnelCount } from "@/lib/redis";
import {
  editSchema,
  MAX_EDIT_BODY_BYTES,
  ReplayError,
  replayToCli,
  replayToDestination,
  resolveEdit,
} from "@/lib/replay";
import { orgProcedure, router } from "../trpc/init";
import { orgEndpoint } from "./request";

const target = z.object({ endpointSlug: z.string(), id: z.uuid() });

function toTrpc(error: unknown): never {
  if (error instanceof ReplayError) {
    throw new TRPCError({
      code:
        error.code === "not_found"
          ? "NOT_FOUND"
          : error.code === "no_tunnel"
            ? "PRECONDITION_FAILED"
            : "BAD_REQUEST",
      message: error.message,
    });
  }
  throw error;
}

async function captured(ctx: Parameters<typeof orgEndpoint>[0], endpointSlug: string, id: string) {
  const endpoint = await orgEndpoint(ctx, endpointSlug);
  const req = await loadCaptured(ctx.db, endpoint, id, MAX_EDIT_BODY_BYTES);
  if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
  return { endpoint, req };
}

function isText(body: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
    return !body.includes(0);
  } catch {
    return false;
  }
}

/** Sends captured requests again: to a destination, to connected CLIs, or edited first. */
export const replayRouter = router({
  /** Where a request can be replayed from this endpoint. */
  targets: orgProcedure
    .input(z.object({ endpointSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const endpoint = await orgEndpoint(ctx, input.endpointSlug);
      const destinations = await ctx.db
        .select({
          id: schema.destination.id,
          name: schema.destination.name,
          url: schema.destination.url,
          enabled: schema.destination.enabled,
        })
        .from(schema.destination)
        .where(eq(schema.destination.endpointId, endpoint.id))
        .orderBy(schema.destination.createdAt);
      return { destinations, tunnels: await tunnelCount(endpoint.id) };
    }),

  /** The request as the edit form starts from. Sensitive header values stay masked. */
  draft: orgProcedure
    .meta({ role: "member" })
    .input(target)
    .query(async ({ ctx, input }) => {
      const { req } = await captured(ctx, input.endpointSlug, input.id);
      const body = req.body;
      const text = body ? isText(body) : true;
      return {
        method: req.method,
        path: req.path,
        query: encodeQuery(req.query),
        headers: maskHeaders(req.headers),
        body: body && text ? new TextDecoder().decode(body) : "",
        bodyBase64: body && !text ? Buffer.from(body).toString("base64") : null,
        bodyEditable: !req.bodyOmitted && text,
        bodySize: req.bodySize,
      };
    }),

  toDestination: orgProcedure
    .meta({ role: "member", audit: "request.replayed" })
    .input(target.extend({ destinationId: z.uuid(), edit: editSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const { endpoint, req } = await captured(ctx, input.endpointSlug, input.id);
      try {
        const override = input.edit ? resolveEdit(req, input.edit) : undefined;
        const deliveryId = await replayToDestination(ctx.db, {
          orgId: ctx.org.id,
          endpointId: endpoint.id,
          requestId: req.id,
          destinationId: input.destinationId,
          ...(override ? { override } : {}),
        });
        ctx.audit({
          type: "request",
          id: req.id,
          metadata: {
            to: "destination",
            destination: input.destinationId,
            edited: Boolean(input.edit),
          },
        });
        return { deliveryId };
      } catch (error) {
        toTrpc(error);
      }
    }),

  toCli: orgProcedure
    .meta({ role: "member", audit: "request.replayed" })
    .input(target.extend({ edit: editSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const endpoint = await orgEndpoint(ctx, input.endpointSlug);
      // Frames carry at most ~720 KiB of body; load a little more to tell.
      const req: CapturedRequest | null = await loadCaptured(
        ctx.db,
        endpoint,
        input.id,
        MAX_EDIT_BODY_BYTES,
      );
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
      try {
        const override = input.edit ? resolveEdit(req, input.edit) : undefined;
        const receivers = await replayToCli(req, override);
        ctx.audit({
          type: "request",
          id: req.id,
          metadata: { to: "cli", edited: Boolean(input.edit) },
        });
        return { receivers };
      } catch (error) {
        toTrpc(error);
      }
    }),
});
