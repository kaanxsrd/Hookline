"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleCheck, CreditCard } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormMessage } from "@/components/auth/form-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type PlanCard = { id: "free" | "pro" | "team"; name: string; features: string[] };

export function BillingSettings({ orgSlug, plans }: { orgSlug: string; plans: PlanCard[] }) {
  const trpc = useTRPC();
  const params = useSearchParams();
  const status = useQuery(trpc.billing.status.queryOptions({ orgSlug }));
  const checkout = useMutation(trpc.billing.checkout.mutationOptions());
  const portal = useMutation(trpc.billing.portal.mutationOptions());

  if (!status.data) return <Skeleton className="h-40 w-full" />;
  const s = status.data;

  async function go(promise: Promise<{ url: string }>) {
    const res = await attempt(promise);
    if (res) window.location.assign(res.url);
  }

  return (
    <div className="grid gap-8">
      {params.get("checkout") === "success" && (
        <p role="status" className="flex items-center gap-2 rounded-lg border p-3 text-sm">
          <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Thanks! Your plan updates as soon as Stripe confirms the payment.
        </p>
      )}

      <section className="grid gap-2">
        <h2 className="font-medium">Current plan</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span data-testid="current-plan" className="text-lg font-semibold">
            {s.planName}
          </span>
          {s.status !== "none" && <Badge variant="outline">{s.status.replace("_", " ")}</Badge>}
          {s.overridden && <Badge variant="secondary">Set by an administrator</Badge>}
        </div>
        {s.currentPeriodEnd && (
          <p className="text-muted-foreground text-sm">
            {s.cancelAtPeriodEnd ? "Ends" : "Renews"} on {s.currentPeriodEnd.toLocaleDateString()}.
          </p>
        )}
      </section>

      {s.instanceUnlimited ? (
        <p className="rounded-lg border border-dashed p-6 text-sm">
          This instance runs with every limit lifted (
          <code className="font-mono">PLAN_OVERRIDE=unlimited</code>), so there is nothing to buy.
        </p>
      ) : !s.enabled ? (
        <p data-testid="billing-disabled" className="rounded-lg border border-dashed p-6 text-sm">
          Billing is disabled on this instance: no payment provider is configured. Plans can still
          be set by an instance administrator.
        </p>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            {plans.map((p) => {
              const current = p.id === s.plan;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "grid content-start gap-3 rounded-lg border p-4",
                    current && "border-primary",
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground text-sm">
                      {p.id === "free" ? "Free" : (s.prices[p.id] ?? "")}
                    </span>
                  </div>
                  <ul className="text-muted-foreground grid gap-1 text-xs">
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  {current ? (
                    <Badge variant="secondary" className="justify-self-start">
                      Current plan
                    </Badge>
                  ) : p.id !== "free" && !s.hasCustomer ? (
                    <Button
                      onClick={() =>
                        go(checkout.mutateAsync({ orgSlug, plan: p.id as "pro" | "team" }))
                      }
                      disabled={checkout.isPending}
                    >
                      Upgrade to {p.name}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </section>
          {s.hasCustomer && (
            <section className="grid gap-2">
              <p className="text-muted-foreground text-sm">
                Change plans, update the card, download invoices or cancel in the Stripe customer
                portal.
              </p>
              <Button
                variant="outline"
                className="justify-self-start"
                onClick={() => go(portal.mutateAsync({ orgSlug }))}
                disabled={portal.isPending}
              >
                <CreditCard aria-hidden /> Manage billing
              </Button>
            </section>
          )}
          <FormMessage error={checkout.error?.message ?? portal.error?.message ?? null} />
        </>
      )}
    </div>
  );
}
