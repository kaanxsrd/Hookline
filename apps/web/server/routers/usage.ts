import "server-only";
import { schema } from "@hookline/db";
import { count, eq } from "drizzle-orm";
import { orgPlan } from "@/lib/plans";
import { dailyRequests, monthUsage } from "@/lib/usage";
import { orgProcedure, router } from "../trpc/init";

/** This month's usage against the plan. */
export const usageRouter = router({
  get: orgProcedure.query(async ({ ctx }) => {
    const [usage, daily, { limits }, [members]] = await Promise.all([
      monthUsage(ctx.db, ctx.org.id),
      dailyRequests(ctx.db, ctx.org.id),
      orgPlan(ctx.db, ctx.org.id),
      ctx.db
        .select({ n: count() })
        .from(schema.member)
        .where(eq(schema.member.organizationId, ctx.org.id)),
    ]);
    return {
      ...usage,
      planName: limits.name,
      daily,
      members: { used: members?.n ?? 0, limit: limits.members },
      limits: {
        retentionHours: limits.retention_hours,
        maxBodyBytes: limits.max_body_bytes,
        concurrentTunnels: limits.concurrent_tunnels,
        destinationsPerEndpoint: limits.destinations_per_endpoint,
      },
    };
  }),
});
