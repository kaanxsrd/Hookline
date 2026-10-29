import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { EndpointTable } from "./endpoint-table";

export const metadata: Metadata = {
  title: "Endpoints",
  description: "Every URL your organization uses to capture webhooks.",
};

export default async function EndpointsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const caller = await api();
  const [org, endpoints] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    load(() => caller.endpoint.list({ orgSlug })),
  ]);
  const canCreate = hasRole(org.role, "member");

  return (
    <PageBody wide>
      <PageHeader
        title="Endpoints"
        description={`${endpoints.length} of ${org.limits.endpoints ?? "unlimited"} on the ${org.limits.name} plan.`}
        actions={
          canCreate && (
            <Button asChild>
              <Link href={`/${orgSlug}/endpoints/new`}>
                <Plus aria-hidden /> New endpoint
              </Link>
            </Button>
          )
        }
      />
      <EndpointTable
        orgSlug={orgSlug}
        endpoints={endpoints.map((e) => ({
          id: e.id,
          slug: e.slug,
          name: e.name,
          url: e.url,
          status: e.status,
          requestCount: e.requestCount,
          lastRequestAt: e.lastRequestAt?.toISOString() ?? null,
        }))}
      />
    </PageBody>
  );
}
