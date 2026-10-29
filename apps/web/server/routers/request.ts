import "server-only";
import { schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { detailColumns, summaryColumns, toDetail, toSummary } from "@/lib/requests";
import { orgProcedure, router } from "../trpc/init";

const r = schema.request;

async function endpointId(
  ctx: { db: import("@hookline/db").Db; org: { id: string } },
  slug: string,
): Promise<string> {
  const [ep] = await ctx.db
    .select({ id: schema.endpoint.id })
    .from(schema.endpoint)
    .where(and(eq(schema.endpoint.slug, slug), eq(schema.endpoint.orgId, ctx.org.id)));
  if (!ep) throw new TRPCError({ code: "NOT_FOUND", message: "Endpoint not found." });
  return ep.id;
}

export const requestRouter = router({
  /** Newest first. The cursor is the last request ID of the previous page (IDs are time-ordered). */
  list: orgProcedure
    .input(
      z.object({
        endpointSlug: z.string(),
        cursor: z.uuid().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const id = await endpointId(ctx, input.endpointSlug);
      const rows = await ctx.db
        .select(summaryColumns)
        .from(r)
        .where(and(eq(r.endpointId, id), input.cursor ? lt(r.id, input.cursor) : undefined))
        .orderBy(desc(r.id))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      return {
        items: page.map(toSummary),
        nextCursor: rows.length > input.limit ? page.at(-1)?.id : undefined,
      };
    }),

  get: orgProcedure
    .input(z.object({ endpointSlug: z.string(), id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const id = await endpointId(ctx, input.endpointSlug);
      const [row] = await ctx.db
        .select(detailColumns)
        .from(r)
        .where(and(eq(r.id, input.id), eq(r.endpointId, id)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
      return toDetail(row);
    }),
});
