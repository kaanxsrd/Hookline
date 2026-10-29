import "server-only";
import { schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { validOrgSlug } from "@/lib/permissions";
import { orgPlan } from "@/lib/plans";
import { authedProcedure, orgProcedure, router } from "../trpc/init";

export const orgRouter = router({
  /** Organizations the user belongs to, for the switcher and redirects. */
  mine: authedProcedure.query(async ({ ctx }) =>
    ctx.db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, ctx.user.id))
      .orderBy(asc(schema.organization.name)),
  ),

  current: orgProcedure.query(async ({ ctx }) => {
    const { plan, limits } = await orgPlan(ctx.db, ctx.org.id);
    return { ...ctx.org, role: ctx.member.role, plan, limits };
  }),

  update: orgProcedure
    .meta({ role: "admin" })
    .input(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        slug: z.string().trim().toLowerCase().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.slug !== undefined && input.slug !== ctx.org.slug) {
        if (!validOrgSlug(input.slug)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Use 3–40 lowercase letters, numbers and dashes, and avoid reserved words.",
          });
        }
        const [taken] = await ctx.db
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(
            and(eq(schema.organization.slug, input.slug), ne(schema.organization.id, ctx.org.id)),
          );
        if (taken) throw new TRPCError({ code: "CONFLICT", message: "That URL is taken." });
      }
      const changes = {
        ...(input.name ? { name: input.name } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
      };
      if (Object.keys(changes).length > 0) {
        await ctx.db
          .update(schema.organization)
          .set(changes)
          .where(eq(schema.organization.id, ctx.org.id));
      }
      ctx.audit({ type: "organization", id: ctx.org.id, metadata: changes });
      return { slug: input.slug ?? ctx.org.slug };
    }),

  delete: orgProcedure
    .meta({ role: "owner", skipAudit: true })
    .input(z.object({ confirm: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.confirm !== ctx.org.slug) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Type the organization's URL to confirm.",
        });
      }
      // Everything owned by the organization cascades, including its audit log.
      await ctx.db.delete(schema.organization).where(eq(schema.organization.id, ctx.org.id));
      return { ok: true };
    }),
});
