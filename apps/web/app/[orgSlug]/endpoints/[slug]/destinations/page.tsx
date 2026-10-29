import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { DestinationsManager } from "./destinations-manager";

export const metadata: Metadata = {
  title: "Destinations",
  description: "Where an endpoint's captured requests are forwarded.",
};

export default async function DestinationsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; slug: string }>;
}) {
  const { orgSlug, slug } = await params;
  const caller = await api();
  const [org, endpoint, destinations] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    load(() => caller.endpoint.get({ orgSlug, slug })),
    load(() => caller.destination.list({ orgSlug, endpointSlug: slug })),
  ]);

  return (
    <PageBody>
      <PageHeader
        title="Destinations"
        description={`Forward requests captured by ${endpoint.name} to your own APIs, with retries.`}
      />
      <DestinationsManager
        orgSlug={orgSlug}
        endpointSlug={slug}
        canEdit={hasRole(org.role, "member")}
        initial={destinations}
      />
    </PageBody>
  );
}
