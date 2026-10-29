import "server-only";
import { type Db, schema } from "@hookline/db";
import { and, desc, eq, gte, ilike, lt, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { orgPlan } from "@/lib/plans";
import { orgProcedure, router } from "../trpc/init";

const a = schema.auditLog;

export const auditFilter = z.object({
  action: z.string().trim().max(64).optional(),
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

/**
 * Audit entries of an organization, newest first, with the actor's name and
 * email, within the plan's audit log window (`days`; null is unlimited).
 */
export async function listAudit(
  db: Db,
  orgId: string,
  filter: z.infer<typeof auditFilter>,
  days: number | null,
) {
  if (days === 0) return { items: [], nextCursor: undefined, days };
  const where: (SQL | undefined)[] = [eq(a.orgId, orgId)];
  if (days !== null) where.push(gte(a.createdAt, sql`now() - make_interval(days => ${days})`));
  if (filter.action) where.push(ilike(a.action, `${filter.action.replace(/[%_\\]/g, "\\$&")}%`));
  if (filter.cursor) where.push(lt(a.id, filter.cursor));
  const rows = await db
    .select({
      id: a.id,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      metadata: a.metadata,
      ip: a.ip,
      createdAt: a.createdAt,
      actorName: schema.user.name,
      actorEmail: schema.user.email,
      actorApiKeyId: a.actorApiKeyId,
    })
    .from(a)
    .leftJoin(schema.user, eq(schema.user.id, a.actorUserId))
    .where(and(...where))
    .orderBy(desc(a.id))
    .limit(filter.limit + 1);
  const page = rows.slice(0, filter.limit);
  return {
    items: page,
    nextCursor: rows.length > filter.limit ? page.at(-1)?.id : undefined,
    days,
  };
}

export const auditRouter = router({
  list: orgProcedure
    .meta({ role: "admin" })
    .input(auditFilter)
    .query(async ({ ctx, input }) => {
      const { limits } = await orgPlan(ctx.db, ctx.org.id);
      return listAudit(ctx.db, ctx.org.id, input, limits.audit_log_days);
    }),
});
