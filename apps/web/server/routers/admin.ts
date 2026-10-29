import "server-only";
import { type Db, schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { billingEnabled, planChanged } from "@/lib/billing";
import { env } from "@/lib/env";
import { orgPlan } from "@/lib/plans";
import { invalidateEndpointCache, publishEndpointEvent } from "@/lib/redis";
import { monthUsage } from "@/lib/usage";
import { adminProcedure, router } from "../trpc/init";

const u = schema.user;
const o = schema.organization;
const m = schema.member;
const e = schema.endpoint;
const s = schema.subscription;
const k = schema.apiKey;

const PAGE = 50;

const listInput = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: z.uuid().optional(),
});

/** ILIKE pattern matching `q` anywhere, with its wildcards escaped. */
function contains(q: string): string {
  return `%${q.replace(/[%_\\]/g, "\\$&")}%`;
}

/** Splits one extra row off to tell whether another page exists. */
function paginate<T extends { id: string }>(rows: T[]) {
  const items = rows.slice(0, PAGE);
  return { items, nextCursor: rows.length > PAGE ? items.at(-1)?.id : undefined };
}

/** Requests this calendar month from the hourly rollup, per organization. */
const monthRequests = (orgId: typeof o.id) =>
  sql<number>`(SELECT coalesce(sum(ud.requests), 0)::float8 FROM usage_daily ud
    WHERE ud.org_id = ${orgId} AND ud.day >= date_trunc('month', now() AT TIME ZONE 'UTC')::date)`;

function isSubscribable(plan: string): plan is "free" | "pro" | "team" {
  return plan === "free" || plan === "pro" || plan === "team";
}

async function findUser(db: Db, id: string) {
  const [row] = await db.select({ id: u.id, email: u.email }).from(u).where(eq(u.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No such user." });
  return row;
}

const usersRouter = router({
  list: adminProcedure.input(listInput).query(async ({ ctx, input }) => {
    const where: (SQL | undefined)[] = [];
    if (input.q)
      where.push(or(ilike(u.email, contains(input.q)), ilike(u.name, contains(input.q))));
    if (input.cursor) where.push(lt(u.id, input.cursor));
    const rows = await ctx.db
      .select({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: u.emailVerified,
        isAdmin: u.isAdmin,
        disabledAt: u.disabledAt,
        createdAt: u.createdAt,
        orgs: sql<number>`(SELECT count(*)::int FROM member WHERE member.user_id = ${u.id})`,
        lastActiveAt:
          sql<Date | null>`(SELECT max(session.updated_at) FROM session WHERE session.user_id = ${u.id})`.mapWith(
            schema.session.updatedAt,
          ),
      })
      .from(u)
      .where(and(...where))
      .orderBy(desc(u.id))
      .limit(PAGE + 1);
    return paginate(rows);
  }),

  get: adminProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const [user] = await ctx.db
      .select({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: u.emailVerified,
        twoFactorEnabled: u.twoFactorEnabled,
        isAdmin: u.isAdmin,
        disabledAt: u.disabledAt,
        createdAt: u.createdAt,
      })
      .from(u)
      .where(eq(u.id, input.id));
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "No such user." });

    const [memberships, sessions, passkeys, apiKeys] = await Promise.all([
      ctx.db
        .select({ orgId: o.id, name: o.name, slug: o.slug, role: m.role, joinedAt: m.createdAt })
        .from(m)
        .innerJoin(o, eq(o.id, m.organizationId))
        .where(eq(m.userId, input.id))
        .orderBy(o.name),
      ctx.db
        .select({
          active: count(),
          lastActiveAt: sql<Date | null>`max(${schema.session.updatedAt})`.mapWith(
            schema.session.updatedAt,
          ),
        })
        .from(schema.session)
        .where(and(eq(schema.session.userId, input.id), gt(schema.session.expiresAt, sql`now()`))),
      ctx.db.select({ n: count() }).from(schema.passkey).where(eq(schema.passkey.userId, input.id)),
      ctx.db
        .select({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          orgSlug: o.slug,
          lastUsedAt: k.lastUsedAt,
          createdAt: k.createdAt,
        })
        .from(k)
        .innerJoin(o, eq(o.id, k.orgId))
        .where(and(eq(k.createdBy, input.id), isNull(k.revokedAt)))
        .orderBy(desc(k.createdAt)),
    ]);

    return {
      ...user,
      isYou: user.id === ctx.user.id,
      memberships,
      activeSessions: sessions[0]?.active ?? 0,
      lastActiveAt: sessions[0]?.lastActiveAt ?? null,
      passkeys: passkeys[0]?.n ?? 0,
      apiKeys,
    };
  }),

  /** Blocks sign-in, ends every session and revokes the API keys (and CLI logins) the user created. */
  disable: adminProcedure
    .meta({ audit: "admin.user.disabled" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot disable your own account.",
        });
      }
      const user = await findUser(ctx.db, input.id);
      const revoked = await ctx.db.transaction(async (tx) => {
        await tx
          .update(u)
          .set({ disabledAt: sql`now()` })
          .where(and(eq(u.id, input.id), isNull(u.disabledAt)));
        await tx.delete(schema.session).where(eq(schema.session.userId, input.id));
        const keys = await tx
          .update(k)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(k.createdBy, input.id), isNull(k.revokedAt)))
          .returning({ id: k.id });
        // A device approval still waiting to be picked up would mint a new key.
        await tx
          .update(schema.cliDeviceCode)
          .set({ status: "denied" })
          .where(
            and(
              eq(schema.cliDeviceCode.userId, input.id),
              inArray(schema.cliDeviceCode.status, ["pending", "approved"]),
            ),
          );
        return keys.length;
      });
      ctx.audit({
        type: "user",
        id: user.id,
        metadata: { email: user.email, revokedApiKeys: revoked },
      });
      return { revokedApiKeys: revoked };
    }),

  enable: adminProcedure
    .meta({ audit: "admin.user.enabled" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUser(ctx.db, input.id);
      await ctx.db.update(u).set({ disabledAt: null }).where(eq(u.id, input.id));
      ctx.audit({ type: "user", id: user.id, metadata: { email: user.email } });
      return { ok: true };
    }),

  grantAdmin: adminProcedure
    .meta({ audit: "admin.user.admin_granted" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUser(ctx.db, input.id);
      await ctx.db.update(u).set({ isAdmin: true }).where(eq(u.id, input.id));
      ctx.audit({ type: "user", id: user.id, metadata: { email: user.email } });
      return { ok: true };
    }),

  revokeAdmin: adminProcedure
    .meta({ audit: "admin.user.admin_revoked" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Also guarantees the instance keeps at least one administrator.
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ask another administrator to remove your access.",
        });
      }
      const user = await findUser(ctx.db, input.id);
      await ctx.db.update(u).set({ isAdmin: false }).where(eq(u.id, input.id));
      ctx.audit({ type: "user", id: user.id, metadata: { email: user.email } });
      return { ok: true };
    }),
});

const orgsRouter = router({
  list: adminProcedure.input(listInput).query(async ({ ctx, input }) => {
    const where: (SQL | undefined)[] = [];
    if (input.q) where.push(or(ilike(o.name, contains(input.q)), ilike(o.slug, contains(input.q))));
    if (input.cursor) where.push(lt(o.id, input.cursor));
    const rows = await ctx.db
      .select({
        id: o.id,
        name: o.name,
        slug: o.slug,
        createdAt: o.createdAt,
        plan: s.plan,
        planOverride: s.planOverride,
        subscriptionStatus: s.status,
        members: sql<number>`(SELECT count(*)::int FROM member WHERE member.organization_id = ${o.id})`,
        endpoints: sql<number>`(SELECT count(*)::int FROM endpoint WHERE endpoint.org_id = ${o.id})`,
        requestsThisMonth: monthRequests(o.id),
      })
      .from(o)
      .leftJoin(s, eq(s.orgId, o.id))
      .where(and(...where))
      .orderBy(desc(o.id))
      .limit(PAGE + 1);
    return paginate(rows);
  }),

  get: adminProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const [org] = await ctx.db
      .select({
        id: o.id,
        name: o.name,
        slug: o.slug,
        createdAt: o.createdAt,
        plan: s.plan,
        planOverride: s.planOverride,
        subscriptionStatus: s.status,
        stripeCustomerId: s.stripeCustomerId,
        currentPeriodEnd: s.currentPeriodEnd,
      })
      .from(o)
      .leftJoin(s, eq(s.orgId, o.id))
      .where(eq(o.id, input.id));
    if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "No such organization." });

    const [members, endpoints, usage] = await Promise.all([
      ctx.db
        .select({
          userId: u.id,
          name: u.name,
          email: u.email,
          role: m.role,
          disabledAt: u.disabledAt,
        })
        .from(m)
        .innerJoin(u, eq(u.id, m.userId))
        .where(eq(m.organizationId, input.id))
        .orderBy(u.name),
      ctx.db
        .select({
          id: e.id,
          slug: e.slug,
          name: e.name,
          status: e.status,
          requestCount: e.requestCount,
          lastRequestAt: e.lastRequestAt,
        })
        .from(e)
        .where(eq(e.orgId, input.id))
        .orderBy(desc(e.createdAt))
        .limit(200),
      monthUsage(ctx.db, input.id),
    ]);

    return {
      ...org,
      effectivePlan: usage.plan,
      instanceOverride: env().PLAN_OVERRIDE || null,
      billingEnabled: billingEnabled(),
      members,
      endpoints,
      usage,
    };
  }),

  /** Assigns a plan that wins over the subscription; null returns to what billing says. */
  setPlan: adminProcedure
    .meta({ audit: "admin.organization.plan_set" })
    .input(z.object({ id: z.uuid(), plan: z.enum(["free", "pro", "team"]).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const [org] = await ctx.db.select({ slug: o.slug }).from(o).where(eq(o.id, input.id));
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "No such organization." });
      const before = await orgPlan(ctx.db, input.id);
      await ctx.db
        .insert(s)
        .values({ orgId: input.id, plan: "free", planOverride: input.plan })
        .onConflictDoUpdate({ target: s.orgId, set: { planOverride: input.plan } });
      const after = await orgPlan(ctx.db, input.id);
      // An instance-wide PLAN_OVERRIDE wins over both, so nothing changes then.
      if (before.plan !== after.plan && isSubscribable(after.plan)) {
        await planChanged(ctx.db, input.id, before.plan, after.plan);
      }
      ctx.audit({
        type: "organization",
        id: input.id,
        metadata: { slug: org.slug, planOverride: input.plan, from: before.plan, to: after.plan },
      });
      return { plan: after.plan };
    }),
});

const endpointsRouter = router({
  list: adminProcedure
    .input(listInput.extend({ status: z.enum(["all", "disabled", "anonymous"]).default("all") }))
    .query(async ({ ctx, input }) => {
      const where: (SQL | undefined)[] = [];
      if (input.q) {
        where.push(
          /^[0-9A-Za-z]{12}$/.test(input.q)
            ? or(eq(e.slug, input.q), ilike(e.name, contains(input.q)))
            : ilike(e.name, contains(input.q)),
        );
      }
      if (input.status === "disabled") where.push(eq(e.status, "disabled_by_admin"));
      if (input.status === "anonymous") where.push(isNull(e.orgId));
      if (input.cursor) where.push(lt(e.id, input.cursor));
      const rows = await ctx.db
        .select({
          id: e.id,
          slug: e.slug,
          name: e.name,
          status: e.status,
          disabledReason: e.disabledReason,
          orgId: e.orgId,
          orgName: o.name,
          orgSlug: o.slug,
          expiresAt: e.expiresAt,
          requestCount: e.requestCount,
          lastRequestAt: e.lastRequestAt,
          createdAt: e.createdAt,
        })
        .from(e)
        .leftJoin(o, eq(o.id, e.orgId))
        .where(and(...where))
        .orderBy(desc(e.id))
        .limit(PAGE + 1);
      return paginate(rows);
    }),

  /** Intake answers 410 endpoint_disabled; owners cannot resume it. */
  disable: adminProcedure
    .meta({ audit: "admin.endpoint.disabled" })
    .input(z.object({ id: z.uuid(), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(e)
        .set({ status: "disabled_by_admin", disabledReason: input.reason })
        .where(eq(e.id, input.id))
        .returning({ id: e.id, slug: e.slug, orgId: e.orgId });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No such endpoint." });
      await invalidateEndpointCache(row.slug);
      await publishEndpointEvent(row.id, "endpoint", { id: row.id, status: "disabled_by_admin" });
      ctx.audit({
        type: "endpoint",
        id: row.id,
        metadata: { slug: row.slug, orgId: row.orgId, reason: input.reason },
      });
      return { ok: true };
    }),

  enable: adminProcedure
    .meta({ audit: "admin.endpoint.enabled" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(e)
        .set({ status: "active", disabledReason: null })
        .where(and(eq(e.id, input.id), eq(e.status, "disabled_by_admin")))
        .returning({ id: e.id, slug: e.slug, orgId: e.orgId });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No disabled endpoint with this ID." });
      }
      await invalidateEndpointCache(row.slug);
      await publishEndpointEvent(row.id, "endpoint", { id: row.id, status: "active" });
      ctx.audit({ type: "endpoint", id: row.id, metadata: { slug: row.slug, orgId: row.orgId } });
      return { ok: true };
    }),
});

export const adminRouter = router({
  overview: adminProcedure.query(async ({ ctx }) => {
    const [totals] = await ctx.db.execute<{
      users: number;
      users_week: number;
      users_disabled: number;
      admins: number;
      orgs: number;
      endpoints: number;
      anonymous_endpoints: number;
      disabled_endpoints: number;
      requests_month: number;
    }>(sql`
      SELECT
        (SELECT count(*) FROM "user")::int AS users,
        (SELECT count(*) FROM "user" WHERE created_at > now() - interval '7 days')::int AS users_week,
        (SELECT count(*) FROM "user" WHERE disabled_at IS NOT NULL)::int AS users_disabled,
        (SELECT count(*) FROM "user" WHERE is_admin)::int AS admins,
        (SELECT count(*) FROM organization)::int AS orgs,
        (SELECT count(*) FROM endpoint WHERE org_id IS NOT NULL)::int AS endpoints,
        (SELECT count(*) FROM endpoint WHERE org_id IS NULL AND expires_at > now())::int AS anonymous_endpoints,
        (SELECT count(*) FROM endpoint WHERE status = 'disabled_by_admin')::int AS disabled_endpoints,
        (SELECT coalesce(sum(requests), 0) FROM usage_daily
          WHERE day >= date_trunc('month', now() AT TIME ZONE 'UTC')::date)::float8 AS requests_month`);

    const plans = await ctx.db
      .select({ plan: sql<string>`coalesce(${s.planOverride}, ${s.plan})`, n: count() })
      .from(s)
      .groupBy(sql`1`);

    const recentUsers = await ctx.db
      .select({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt,
        disabledAt: u.disabledAt,
      })
      .from(u)
      .orderBy(desc(u.id))
      .limit(8);

    return {
      totals: {
        users: totals?.users ?? 0,
        usersThisWeek: totals?.users_week ?? 0,
        usersDisabled: totals?.users_disabled ?? 0,
        admins: totals?.admins ?? 0,
        orgs: totals?.orgs ?? 0,
        endpoints: totals?.endpoints ?? 0,
        anonymousEndpoints: totals?.anonymous_endpoints ?? 0,
        disabledEndpoints: totals?.disabled_endpoints ?? 0,
        requestsThisMonth: Number(totals?.requests_month ?? 0),
      },
      plans: Object.fromEntries(plans.map((p) => [p.plan, p.n])) as Record<string, number>,
      recentUsers,
      instance: {
        billingEnabled: billingEnabled(),
        planOverride: env().PLAN_OVERRIDE || null,
      },
    };
  }),

  /** Instance-level audit entries: what administrators did. */
  auditLog: adminProcedure
    .input(z.object({ action: z.string().trim().max(64).optional(), cursor: z.uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const a = schema.auditLog;
      const where: (SQL | undefined)[] = [isNull(a.orgId)];
      if (input.action) where.push(ilike(a.action, `${input.action.replace(/[%_\\]/g, "\\$&")}%`));
      if (input.cursor) where.push(lt(a.id, input.cursor));
      const rows = await ctx.db
        .select({
          id: a.id,
          action: a.action,
          targetType: a.targetType,
          targetId: a.targetId,
          metadata: a.metadata,
          ip: a.ip,
          createdAt: a.createdAt,
          actorName: u.name,
          actorEmail: u.email,
        })
        .from(a)
        .leftJoin(u, eq(u.id, a.actorUserId))
        .where(and(...where))
        .orderBy(desc(a.id))
        .limit(PAGE + 1);
      return paginate(rows);
    }),

  users: usersRouter,
  orgs: orgsRouter,
  endpoints: endpointsRouter,
});
