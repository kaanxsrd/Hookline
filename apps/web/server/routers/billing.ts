import "server-only";
import { schema } from "@hookline/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { billingEnabled, createCheckout, createPortal, planPrices } from "@/lib/billing";
import { env } from "@/lib/env";
import { orgPlan } from "@/lib/plans";
import { orgProcedure, router } from "../trpc/init";

function failed(error: unknown): never {
  console.error("billing request failed", error);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Billing is unavailable right now. Try again shortly.",
  });
}

/** Plan, Stripe Checkout and the Customer Portal (owners and admins). */
export const billingRouter = router({
  status: orgProcedure.meta({ role: "admin" }).query(async ({ ctx }) => {
    const { plan, limits } = await orgPlan(ctx.db, ctx.org.id);
    const [sub] = await ctx.db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.orgId, ctx.org.id));
    return {
      enabled: billingEnabled(),
      instanceUnlimited: env().PLAN_OVERRIDE === "unlimited",
      plan,
      planName: limits.name,
      overridden: Boolean(sub?.planOverride),
      status: sub?.status ?? "none",
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      hasCustomer: Boolean(sub?.stripeCustomerId),
      prices: await planPrices().catch((error: unknown): Awaited<ReturnType<typeof planPrices>> => {
        console.error("could not load Stripe prices", error);
        return {};
      }),
    };
  }),

  checkout: orgProcedure
    .meta({ role: "admin", audit: "billing.checkout_started" })
    .input(z.object({ plan: z.enum(["pro", "team"]) }))
    .mutation(async ({ ctx, input }) => {
      if (!billingEnabled())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Billing is disabled on this instance.",
        });
      ctx.audit({ type: "organization", id: ctx.org.id, metadata: { plan: input.plan } });
      const url = await createCheckout(ctx.db, ctx.org, input.plan, ctx.user.email).catch(failed);
      return { url };
    }),

  portal: orgProcedure.meta({ role: "admin", skipAudit: true }).mutation(async ({ ctx }) => {
    if (!billingEnabled())
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Billing is disabled on this instance.",
      });
    return { url: await createPortal(ctx.db, ctx.org).catch(failed) };
  }),
});
