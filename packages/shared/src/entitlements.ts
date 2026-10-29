/**
 * Plan limits, generated from config/plans.json (see entitlements.gen.ts).
 * The Go services use the same data through packages/gocommon/entitlements.
 * A limit of null means unlimited.
 */
import { anonymousRules, intakeRules, plans } from "./entitlements.gen";

export { anonymousRules, intakeRules, plans };

export type Plan = keyof typeof plans;
export type PaidPlan = "free" | "pro" | "team";
export type Limits = { name: string } & {
  [K in Exclude<keyof (typeof plans)["free"], "name">]: number | null;
};

export const paidPlans: readonly PaidPlan[] = ["free", "pro", "team"];

export function limitsFor(plan: Plan): Limits {
  return plans[plan];
}

/** Whether n stays within limit (null = unlimited). */
export function within(limit: number | null, n: number): boolean {
  return limit === null || n <= limit;
}

/**
 * The plan in force for an endpoint's owner. Mirrors entitlements.Resolve in Go:
 * instance override, then anonymous (no org), then admin override, then the
 * subscribed plan, defaulting to free.
 */
export function resolvePlan(options: {
  instanceOverride?: string | undefined;
  hasOrg: boolean;
  plan?: string | null | undefined;
  planOverride?: string | null | undefined;
}): Plan {
  const pick = (value: string | null | undefined): Plan | undefined =>
    value && value in plans ? (value as Plan) : undefined;
  return (
    pick(options.instanceOverride) ??
    (options.hasOrg ? (pick(options.planOverride) ?? pick(options.plan) ?? "free") : "anonymous")
  );
}
