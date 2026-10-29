import { limitsFor, type PaidPlan } from "@hookline/shared";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { billingEnabled, planPrices } from "@/lib/billing";
import { planFeatures, planLimitRows } from "@/lib/plan-features";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Start free, upgrade when your webhooks outgrow it. Every plan includes the live inbox, replay, signature checks and the CLI tunnel.",
};

const PLANS: { id: PaidPlan; pitch: string; featured?: boolean }[] = [
  { id: "free", pitch: "For trying things out and side projects." },
  { id: "pro", pitch: "For developers shipping integrations.", featured: true },
  { id: "team", pitch: "For teams that share endpoints and need an audit trail." },
];

const FAQ = [
  {
    q: "What happens when I reach my monthly requests?",
    a: "Intake answers 429 quota_exceeded until the next month starts or you upgrade. Owners and admins are emailed at 80 % and 100 %, and the usage page shows where you stand.",
  },
  {
    q: "What counts as a request?",
    a: "Every HTTP request captured by one of your endpoints, whatever its method or size. Replays, deliveries and tunnel traffic do not count again.",
  },
  {
    q: "What happens to old requests?",
    a: "Each endpoint keeps requests for its retention period, up to your plan's history, then deletes them with their bodies.",
  },
  {
    q: "Can I run Hookline myself?",
    a: "Yes. Hookline is open source under the MIT license. Self-hosted instances usually lift every limit with PLAN_OVERRIDE=unlimited.",
  },
];

async function prices(): Promise<Partial<Record<PaidPlan, string>>> {
  if (!billingEnabled()) return {};
  try {
    return await planPrices();
  } catch (error) {
    // The page still works without amounts; the billing page shows them later.
    console.warn("could not load plan prices from Stripe", error);
    return {};
  }
}

export default async function PricingPage() {
  const amounts = await prices();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Pricing</h1>
        <p className="text-muted-foreground mt-4 text-lg">
          Start free and upgrade when your webhooks outgrow it. Every plan includes the live inbox,
          replay, signature checks, destinations and the CLI tunnel.
        </p>
      </div>

      <ul className="mt-12 grid gap-4 lg:grid-cols-3">
        {PLANS.map(({ id, pitch, featured }) => {
          const price = id === "free" ? "$0" : amounts[id];
          return (
            <li
              key={id}
              className={cn(
                "bg-card flex flex-col rounded-xl border p-6",
                featured && "border-primary ring-primary/20 ring-4",
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{limitsFor(id).name}</h2>
                {featured && (
                  <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                    Popular
                  </span>
                )}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{pitch}</p>
              <p className="mt-6 text-3xl font-semibold tracking-tight" data-testid={`price-${id}`}>
                {price ?? <span className="text-muted-foreground text-base">Paid plan</span>}
                {id === "free" && (
                  <span className="text-muted-foreground text-sm font-normal"> forever</span>
                )}
              </p>
              <ul className="mt-6 flex-1 space-y-2 text-sm">
                {planFeatures(id).map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8" variant={featured ? "default" : "outline"}>
                <Link href="/sign-up">
                  {id === "free" ? "Start for free" : `Choose ${limitsFor(id).name}`}
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
      {!billingEnabled() && (
        <p className="text-muted-foreground mt-4 text-sm">
          Billing is not configured on this instance; an administrator assigns plans.
        </p>
      )}

      <section aria-labelledby="compare" className="mt-24">
        <h2 id="compare" className="text-2xl font-semibold tracking-tight">
          Compare plans
        </h2>
        <div className="mt-6 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Limit</span>
                </th>
                {PLANS.map(({ id }) => (
                  <th key={id} scope="col" className="px-4 py-3 font-medium">
                    {limitsFor(id).name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {planLimitRows(limitsFor("free")).map(([label], row) => (
                <tr key={label} className="border-t">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {label}
                  </th>
                  {PLANS.map(({ id }) => (
                    <td key={id} className="px-4 py-3 tabular-nums">
                      {planLimitRows(limitsFor(id))[row]?.[1]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="faq" className="mt-24 max-w-3xl">
        <h2 id="faq" className="text-2xl font-semibold tracking-tight">
          Questions
        </h2>
        <dl className="mt-6 divide-y border-y">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="py-5">
              <dt className="font-medium">{q}</dt>
              <dd className="text-muted-foreground mt-2 text-sm">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
