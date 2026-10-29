import { limitsFor } from "@hookline/shared";
import type { Metadata } from "next";
import { Suspense } from "react";
import { planFeatures } from "@/lib/plan-features";
import { BillingSettings } from "./billing-settings";

export const metadata: Metadata = {
  title: "Billing",
  description: "Your plan, payment and invoices.",
};

export default async function BillingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const plans = (["free", "pro", "team"] as const).map((id) => ({
    id,
    name: limitsFor(id).name,
    features: planFeatures(id),
  }));
  return (
    <Suspense>
      <BillingSettings orgSlug={orgSlug} plans={plans} />
    </Suspense>
  );
}
