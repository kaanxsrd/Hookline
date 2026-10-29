import "server-only";
import { schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { API_SCOPES } from "@/lib/api-keys";
import { writeAudit } from "@/lib/audit";
import { findPendingCode, normalizeUserCode } from "@/lib/device-codes";
import { hasRole, type Role } from "@/lib/permissions";
import { authedProcedure, router } from "../trpc/init";

const d = schema.cliDeviceCode;

const codeInput = z.string().trim().min(8).max(16);

function parseCode(input: string): string {
  const code = normalizeUserCode(input);
  if (!code)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter the 8-letter code shown in your terminal.",
    });
  return code;
}

const expired = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "This code is unknown, expired or already used. Run `hookline login` again.",
  });

/** Device-code approval for `hookline login` (see lib/device-codes.ts). */
export const cliRouter = router({
  /** The pending login a code belongs to, and the organizations it can be approved for. */
  lookup: authedProcedure.input(z.object({ code: codeInput })).query(async ({ ctx, input }) => {
    const pending = await findPendingCode(ctx.db, parseCode(input.code));
    if (!pending) throw expired();
    const orgs = await ctx.db
      .select({
        slug: schema.organization.slug,
        name: schema.organization.name,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, ctx.user.id))
      .orderBy(schema.organization.name);
    return {
      clientName: pending.clientName,
      createdAt: pending.createdAt,
      expiresAt: pending.expiresAt,
      scopes: API_SCOPES,
      orgs: orgs
        .filter((o) => hasRole(o.role as Role, "member"))
        .map(({ slug, name }) => ({ slug, name })),
    };
  }),

  approve: authedProcedure
    .input(z.object({ code: codeInput, orgSlug: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const code = parseCode(input.code);
      const [membership] = await ctx.db
        .select({ orgId: schema.organization.id, role: schema.member.role })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .where(
          and(eq(schema.organization.slug, input.orgSlug), eq(schema.member.userId, ctx.user.id)),
        );
      if (!membership)
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
      if (!hasRole(membership.role as Role, "member")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot authorize the CLI." });
      }
      const [row] = await ctx.db
        .update(d)
        .set({ status: "approved", orgId: membership.orgId, userId: ctx.user.id })
        .where(and(eq(d.userCode, code), eq(d.status, "pending"), gt(d.expiresAt, sql`now()`)))
        .returning({ id: d.id, clientName: d.clientName });
      if (!row) throw expired();
      await writeAudit(ctx.db, {
        orgId: membership.orgId,
        actorUserId: ctx.user.id,
        action: "cli.authorized",
        targetType: "cli_device_code",
        targetId: row.id,
        metadata: { client: row.clientName },
        ip: ctx.ip,
      });
      return { ok: true };
    }),

  deny: authedProcedure.input(z.object({ code: codeInput })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .update(d)
      .set({ status: "denied", userId: ctx.user.id })
      .where(and(eq(d.userCode, parseCode(input.code)), eq(d.status, "pending")))
      .returning({ id: d.id });
    if (!row) throw expired();
    return { ok: true };
  }),
});
