import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { DeliveriesTable } from "./deliveries-table";

export const metadata: Metadata = {
  title: "Deliveries",
  description: "Every forwarded request across the organization's endpoints.",
};

const STATUSES = ["pending", "succeeded", "failed", "cancelled"] as const;

export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { orgSlug } = await params;
  const { status } = await searchParams;
  const caller = await api();
  const [org, endpoints] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    load(() => caller.endpoint.list({ orgSlug })),
  ]);
  const initialStatus = STATUSES.find((s) => s === status);

  return (
    <PageBody wide>
      <PageHeader
        title="Deliveries"
        description="Requests forwarded to your destinations, with their retries."
      />
      <DeliveriesTable
        orgSlug={orgSlug}
        endpoints={endpoints.map((e) => ({ slug: e.slug, name: e.name }))}
        canRetry={hasRole(org.role, "member")}
        initialStatus={initialStatus}
      />
    </PageBody>
  );
}
