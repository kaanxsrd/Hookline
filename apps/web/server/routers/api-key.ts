import "server-only";
import { schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { API_SCOPES, createApiKey } from "@/lib/api-keys";
import { hasRole } from "@/lib/permissions";
import { orgProcedure, router } from "../trpc/init";

const k = schema.apiKey;

/** API keys of the organization. Members manage their own keys; admins any key. */
export const apiKeyRouter = router({
  list: orgProcedure.meta({ role: "member" }).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
        createdBy: k.createdBy,
        creatorName: schema.user.name,
        creatorEmail: schema.user.email,
        expired: sql<boolean>`coalesce(${k.expiresAt} <= now(), false)`,
      })
      .from(k)
      .leftJoin(schema.user, eq(schema.user.id, k.createdBy))
      .where(and(eq(k.orgId, ctx.org.id), isNull(k.revokedAt)))
      .orderBy(desc(k.createdAt));
    const isAdmin = hasRole(ctx.member.role, "admin");
    return rows.map((r) => ({ ...r, canRevoke: isAdmin || r.createdBy === ctx.user.id }));
  }),

  create: orgProcedure
    .meta({ role: "member" })
    .input(
      z.object({
        name: z.string().trim().min(1, "Name the key").max(100),
        scopes: z.array(z.enum(API_SCOPES)).min(1, "Pick at least one scope"),
        expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scopes = [...new Set(input.scopes)];
      const created = await ctx.db.transaction(async (tx) => {
        const key = await createApiKey(tx, {
          orgId: ctx.org.id,
          createdBy: ctx.user.id,
          name: input.name,
          scopes,
        });
        if (input.expiresInDays) {
          await tx
            .update(k)
            .set({ expiresAt: sql`now() + make_interval(days => ${input.expiresInDays})` })
            .where(eq(k.id, key.id));
        }
        return key;
      });
      ctx.audit({
        type: "api_key",
        id: created.id,
        metadata: {
          name: input.name,
          prefix: created.prefix,
          scopes,
          expiresInDays: input.expiresInDays,
        },
      });
      return { id: created.id, key: created.key, prefix: created.prefix };
    }),

  revoke: orgProcedure
    .meta({ role: "member" })
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: k.id, createdBy: k.createdBy, prefix: k.prefix, name: k.name })
        .from(k)
        .where(and(eq(k.id, input.id), eq(k.orgId, ctx.org.id), isNull(k.revokedAt)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found." });
      if (row.createdBy !== ctx.user.id && !hasRole(ctx.member.role, "admin")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can revoke other people's keys.",
        });
      }
      await ctx.db.update(k).set({ revokedAt: new Date() }).where(eq(k.id, row.id));
      ctx.audit({ type: "api_key", id: row.id, metadata: { name: row.name, prefix: row.prefix } });
      return { ok: true };
    }),
});
