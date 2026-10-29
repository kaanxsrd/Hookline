import "server-only";
import { type Db, schema } from "@hookline/db";
import { initTRPC, TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import superjson from "superjson";
import { z } from "zod";
import { type AuditEntry, writeAudit } from "@/lib/audit";
import type { Session } from "@/lib/auth";
import { hasRole, type Role } from "@/lib/permissions";

export type Context = {
  db: Db;
  session: Session | null;
  headers: Headers;
  ip: string | null;
};

export type Meta = {
  /** Lowest organization role allowed to call the procedure (org procedures only). */
  role?: Role;
  /** Audit action for mutations; defaults to the procedure path (e.g. "endpoint.create"). */
  audit?: string;
  /** Mutations that are not worth auditing (e.g. marking something as seen). */
  skipAudit?: boolean;
};

const t = initTRPC
  .context<Context>()
  .meta<Meta>()
  .create({
    transformer: superjson,
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        data: {
          ...shape.data,
          // Field errors for forms; never stack traces.
          zodError: error.cause instanceof z.ZodError ? z.flattenError(error.cause) : null,
          stack: undefined,
        },
      };
    },
  });

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/** A signed-in user with a verified email address. */
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  if (!ctx.session.user.emailVerified) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Verify your email address first." });
  }
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.session.user } });
});

/** Target details a handler records for its audit entry. */
export type AuditTarget = {
  type?: string;
  id?: string;
  metadata?: Record<string, unknown>;
};

/**
 * A member of the organization named by `orgSlug` with at least `meta.role`
 * (viewer by default). Every successful mutation is written to the audit
 * log; handlers describe the target with `ctx.audit(...)`.
 */
export const orgProcedure = authedProcedure
  .input(z.object({ orgSlug: z.string().min(1).max(64) }))
  .use(async ({ ctx, input, meta, next, type, path }) => {
    const [membership] = await ctx.db
      .select({
        orgId: schema.organization.id,
        orgName: schema.organization.name,
        orgSlug: schema.organization.slug,
        memberId: schema.member.id,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(
        and(eq(schema.organization.slug, input.orgSlug), eq(schema.member.userId, ctx.user.id)),
      );
    // Non-members cannot tell an existing organization from a missing one.
    if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
    const required = meta?.role ?? "viewer";
    if (!hasRole(membership.role, required)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This needs the ${required} role or higher.`,
      });
    }

    const target: AuditTarget = {};
    const result = await next({
      ctx: {
        ...ctx,
        org: { id: membership.orgId, name: membership.orgName, slug: membership.orgSlug },
        member: { id: membership.memberId, role: membership.role as Role },
        audit: (details: AuditTarget) => Object.assign(target, details),
      },
    });

    if (result.ok && type === "mutation" && !meta?.skipAudit) {
      const entry: AuditEntry = {
        orgId: membership.orgId,
        actorUserId: ctx.user.id,
        action: meta?.audit ?? path,
        targetType: target.type ?? null,
        targetId: target.id ?? null,
        metadata: target.metadata ?? {},
        ip: ctx.ip,
      };
      await writeAudit(ctx.db, entry);
    }
    return result;
  });
