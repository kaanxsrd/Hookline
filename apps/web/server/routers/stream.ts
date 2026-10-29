import "server-only";
import { schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/lib/env";
import { STREAM_TOKEN_TTL_SECONDS, signStreamToken } from "@/lib/stream-token";
import { orgProcedure, router } from "../trpc/init";

export const streamRouter = router({
  /** A five-minute token for the edge's SSE stream of one endpoint of this organization. */
  token: orgProcedure.input(z.object({ endpointId: z.uuid() })).query(async ({ ctx, input }) => {
    const [ep] = await ctx.db
      .select({ id: schema.endpoint.id })
      .from(schema.endpoint)
      .where(and(eq(schema.endpoint.id, input.endpointId), eq(schema.endpoint.orgId, ctx.org.id)));
    if (!ep) throw new TRPCError({ code: "NOT_FOUND", message: "Endpoint not found." });

    const { EDGE_PUBLIC_URL, STREAM_TOKEN_SECRET } = env();
    const issuedAt = Math.floor(Date.now() / 1000);
    return {
      url: `${EDGE_PUBLIC_URL}/v1/stream/${ep.id}`,
      token: signStreamToken(
        STREAM_TOKEN_SECRET,
        { sub: ctx.user.id, org: ctx.org.id, ep: ep.id },
        issuedAt,
      ),
      expiresAt: (issuedAt + STREAM_TOKEN_TTL_SECONDS) * 1000,
    };
  }),
});
