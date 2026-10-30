import { limitsFor, type PaidPlan } from "@hookline/shared";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GlowingEffect } from "@/components/aceternity/glowing-effect";
import { PageHero } from "@/components/marketing/page-hero";
import { SectionHeading } from "@/components/marketing/section-heading";
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
    a: "Yes. Hookline is free software under the GNU GPL v3. Self-hosted instances usually lift every limit with PLAN_OVERRIDE=unlimited.",
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
    <>
      <PageHero eyebrow="Pricing" title="Pricing">
        Start free and upgrade when your webhooks outgrow it. Every plan includes the live inbox,
        replay, signature checks, destinations and the CLI tunnel.
      </PageHero>

      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <ul className="grid gap-5 lg:grid-cols-3">
          {PLANS.map(({ id, pitch, featured }) => {
            const price = id === "free" ? "$0" : amounts[id];
            return (
              <li
                key={id}
                className={cn(
                  "relative rounded-2xl p-px",
                  featured
                    ? "from-primary via-brand-cyan to-primary bg-gradient-to-br shadow-[0_0_60px_-20px_var(--primary)]"
                    : "border",
                )}
              >
                {!featured && (
                  <GlowingEffect
                    spread={40}
                    glow
                    disabled={false}
                    proximity={64}
                    inactiveZone={0.01}
                  />
                )}
                <div className="bg-card relative flex h-full flex-col rounded-[calc(1rem-1px)] p-7">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{limitsFor(id).name}</h2>
                    {featured && (
                      <span className="from-primary to-brand-cyan text-primary-foreground rounded-full bg-gradient-to-r px-2.5 py-0.5 text-xs font-medium">
                        Popular
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">{pitch}</p>
                  <p
                    className="mt-8 text-4xl font-semibold tracking-tight"
                    data-testid={`price-${id}`}
                  >
                    {price ?? <span className="text-muted-foreground text-base">Paid plan</span>}
                    {id === "free" && (
                      <span className="text-muted-foreground text-sm font-normal"> forever</span>
                    )}
                  </p>
                  <ul className="mt-8 flex-1 space-y-2.5 text-sm">
                    {planFeatures(id).map((f) => (
                      <li key={f} className="flex gap-2.5">
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
                </div>
              </li>
            );
          })}
        </ul>
        {!billingEnabled() && (
          <p className="text-muted-foreground mt-4 text-sm">
            Billing is not configured on this instance; an administrator assigns plans.
          </p>
        )}

        <section aria-labelledby="compare" className="mt-28">
          <SectionHeading id="compare" eyebrow="Limits" title="Compare plans" />
          <div className="bg-card/60 mt-8 overflow-x-auto rounded-2xl border backdrop-blur">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b">
                  <th scope="col" className="px-5 py-4 font-medium">
                    <span className="sr-only">Limit</span>
                  </th>
                  {PLANS.map(({ id, featured }) => (
                    <th
                      key={id}
                      scope="col"
                      className={cn("px-5 py-4 font-medium", featured && "text-primary")}
                    >
                      {limitsFor(id).name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planLimitRows(limitsFor("free")).map(([label], row) => (
                  <tr key={label} className="hover:bg-accent/40 border-t transition-colors">
                    <th
                      scope="row"
                      className="text-muted-foreground px-5 py-3.5 text-left font-normal"
                    >
                      {label}
                    </th>
                    {PLANS.map(({ id, featured }) => (
                      <td
                        key={id}
                        className={cn(
                          "px-5 py-3.5 font-mono text-xs tabular-nums",
                          featured && "bg-primary/5",
                        )}
                      >
                        {planLimitRows(limitsFor(id))[row]?.[1]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="faq" className="mt-28 grid gap-10 md:grid-cols-[1fr_2fr]">
          <SectionHeading id="faq" eyebrow="FAQ" title="Questions" />
          <dl className="divide-y border-y">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="py-6">
                <dt className="font-medium">{q}</dt>
                <dd className="text-muted-foreground mt-2 text-sm leading-relaxed">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
