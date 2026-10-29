import "server-only";
import { type Db, schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { hasRole } from "@/lib/permissions";
import {
  deleteRequest,
  type EndpointRef,
  getRequestDetail,
  listInputSchema,
  listRequests,
} from "@/lib/requests";
import { orgProcedure, router } from "../trpc/init";

/** The endpoint `slug` of the caller's organization, or NOT_FOUND. */
export async function orgEndpoint(
  ctx: { db: Db; org: { id: string } },
  slug: string,
): Promise<EndpointRef> {
  const [ep] = await ctx.db
    .select({ id: schema.endpoint.id, slug: schema.endpoint.slug })
    .from(schema.endpoint)
    .where(and(eq(schema.endpoint.slug, slug), eq(schema.endpoint.orgId, ctx.org.id)));
  if (!ep) throw new TRPCError({ code: "NOT_FOUND", message: "Endpoint not found." });
  return ep;
}

export const requestRouter = router({
  /** Newest first, filtered. The cursor is the last request ID of the previous page. */
  list: orgProcedure
    .input(listInputSchema.extend({ endpointSlug: z.string() }))
    .query(async ({ ctx, input }) =>
      listRequests(ctx.db, await orgEndpoint(ctx, input.endpointSlug), input),
    ),

  /**
   * One request. Sensitive headers stay masked unless `reveal`, which needs
   * the member role and is written to the audit log.
   */
  get: orgProcedure
    .input(z.object({ endpointSlug: z.string(), id: z.uuid(), reveal: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      if (input.reveal && !hasRole(ctx.member.role, "member")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Viewers cannot reveal sensitive headers.",
        });
      }
      const endpoint = await orgEndpoint(ctx, input.endpointSlug);
      const detail = await getRequestDetail(ctx.db, endpoint, input.id, { reveal: input.reveal });
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
      if (input.reveal && detail.headers.length > 0) {
        await writeAudit(ctx.db, {
          orgId: ctx.org.id,
          actorUserId: ctx.user.id,
          action: "request.headers_revealed",
          targetType: "request",
          targetId: input.id,
          metadata: { endpoint: endpoint.slug },
          ip: ctx.ip,
        });
      }
      return detail;
    }),

  delete: orgProcedure
    .meta({ role: "member" })
    .input(z.object({ endpointSlug: z.string(), id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const endpoint = await orgEndpoint(ctx, input.endpointSlug);
      if (!(await deleteRequest(ctx.db, endpoint, input.id))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
      }
      ctx.audit({ type: "request", id: input.id, metadata: { endpoint: endpoint.slug } });
      return { ok: true };
    }),
});
