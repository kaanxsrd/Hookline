import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { EndpointSettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Endpoint settings",
  description: "Name, status and deletion of an endpoint.",
};

export default async function EndpointSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; slug: string }>;
}) {
  const { orgSlug, slug } = await params;
  const caller = await api();
  const [org, endpoint] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    load(() => caller.endpoint.get({ orgSlug, slug })),
  ]);

  return (
    <PageBody>
      <PageHeader title="Settings" description={endpoint.name} />
      <EndpointSettingsForm
        orgSlug={orgSlug}
        canEdit={hasRole(org.role, "member")}
        endpoint={{
          slug: endpoint.slug,
          name: endpoint.name,
          description: endpoint.description,
          status: endpoint.status,
        }}
      />
    </PageBody>
  );
}
