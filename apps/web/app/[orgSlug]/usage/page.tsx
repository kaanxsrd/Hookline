import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { UsageView } from "./usage-view";

export const metadata: Metadata = {
  title: "Usage",
  description: "This month's requests, storage, deliveries and tunnels against your plan.",
};

export default async function UsagePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const caller = await api();
  const [org, usage] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    load(() => caller.usage.get({ orgSlug })),
  ]);
  return (
    <PageBody>
      <PageHeader title="Usage" description="This calendar month against your plan." />
      <UsageView orgSlug={orgSlug} initial={usage} canManageBilling={hasRole(org.role, "admin")} />
    </PageBody>
  );
}
