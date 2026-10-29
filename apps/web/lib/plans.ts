import "server-only";
import { type Db, schema } from "@hookline/db";
import { type Limits, limitsFor, type Plan, resolvePlan } from "@hookline/shared";
import { eq } from "drizzle-orm";
import { env } from "./env";

/** The plan and limits in force for an organization. */
export async function orgPlan(db: Db, orgId: string): Promise<{ plan: Plan; limits: Limits }> {
  const [sub] = await db
    .select({ plan: schema.subscription.plan, planOverride: schema.subscription.planOverride })
    .from(schema.subscription)
    .where(eq(schema.subscription.orgId, orgId));
  const plan = resolvePlan({
    instanceOverride: env().PLAN_OVERRIDE || undefined,
    hasOrg: true,
    plan: sub?.plan,
    planOverride: sub?.planOverride,
  });
  return { plan, limits: limitsFor(plan) };
}
