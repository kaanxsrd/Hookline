import { limitsFor } from "@hookline/shared";
import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingSettings } from "./billing-settings";

export const metadata: Metadata = {
  title: "Billing",
  description: "Your plan, payment and invoices.",
};

function features(plan: "free" | "pro" | "team"): string[] {
  const l = limitsFor(plan);
  const n = (v: number | null, unit: string) =>
    v === null ? `Unlimited ${unit}` : `${v.toLocaleString("en-US")} ${unit}`;
  return [
    n(l.requests_per_month, "requests a month"),
    n(l.endpoints, "endpoints"),
    `${l.retention_hours < 48 ? `${l.retention_hours} hours` : `${Math.round(l.retention_hours / 24)} days`} of history`,
    n(l.destinations_per_endpoint, "destinations per endpoint"),
    n(l.concurrent_tunnels, "CLI tunnels at once"),
    n(l.members, "members"),
  ];
}

export default async function BillingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const plans = (["free", "pro", "team"] as const).map((id) => ({
    id,
    name: limitsFor(id).name,
    features: features(id),
  }));
  return (
    <Suspense>
      <BillingSettings orgSlug={orgSlug} plans={plans} />
    </Suspense>
  );
}
