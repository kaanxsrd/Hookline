import "server-only";
import { schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { orgProcedure, router } from "../trpc/init";

const assignableRole = z.enum(["viewer", "member", "admin", "owner"]);

/** Better Auth's organization endpoints, with their errors mapped to tRPC errors. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof APIError) {
      const code =
        error.statusCode === 403
          ? "FORBIDDEN"
          : error.statusCode === 404
            ? "NOT_FOUND"
            : "BAD_REQUEST";
      throw new TRPCError({ code, message: error.message });
    }
    throw error;
  }
}

export const memberRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    const members = await ctx.db
      .select({
        id: schema.member.id,
        userId: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        role: schema.member.role,
        joinedAt: schema.member.createdAt,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, ctx.org.id))
      .orderBy(asc(schema.member.createdAt));
    const invitations = hasRole(ctx.member.role, "admin")
      ? await ctx.db
          .select({
            id: schema.invitation.id,
            email: schema.invitation.email,
            role: schema.invitation.role,
            expiresAt: schema.invitation.expiresAt,
          })
          .from(schema.invitation)
          .where(
            and(
              eq(schema.invitation.organizationId, ctx.org.id),
              eq(schema.invitation.status, "pending"),
              gt(schema.invitation.expiresAt, new Date()),
            ),
          )
      : [];
    return { members, invitations, you: { memberId: ctx.member.id, role: ctx.member.role } };
  }),

  invite: orgProcedure
    .meta({ role: "admin", audit: "invitation.created" })
    .input(z.object({ email: z.email().max(254), role: assignableRole.exclude(["owner"]) }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await call(() =>
        getAuth().api.createInvitation({
          headers: ctx.headers,
          body: { email: input.email.toLowerCase(), role: input.role, organizationId: ctx.org.id },
        }),
      );
      ctx.audit({
        type: "invitation",
        id: invitation.id,
        metadata: { email: input.email, role: input.role },
      });
      return { id: invitation.id };
    }),

  cancelInvitation: orgProcedure
    .meta({ role: "admin", audit: "invitation.cancelled" })
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await call(() =>
        getAuth().api.cancelInvitation({
          headers: ctx.headers,
          body: { invitationId: input.invitationId },
        }),
      );
      ctx.audit({ type: "invitation", id: input.invitationId });
      return { ok: true };
    }),

  updateRole: orgProcedure
    .meta({ role: "admin", audit: "member.role_changed" })
    .input(z.object({ memberId: z.string(), role: assignableRole }))
    .mutation(async ({ ctx, input }) => {
      if (input.role === "owner" && ctx.member.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only owners can make someone an owner.",
        });
      }
      await call(() =>
        getAuth().api.updateMemberRole({
          headers: ctx.headers,
          body: { memberId: input.memberId, role: input.role, organizationId: ctx.org.id },
        }),
      );
      ctx.audit({ type: "member", id: input.memberId, metadata: { role: input.role } });
      return { ok: true };
    }),

  remove: orgProcedure
    .meta({ role: "admin", audit: "member.removed" })
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await call(() =>
        getAuth().api.removeMember({
          headers: ctx.headers,
          body: { memberIdOrEmail: input.memberId, organizationId: ctx.org.id },
        }),
      );
      ctx.audit({ type: "member", id: input.memberId });
      return { ok: true };
    }),
});
