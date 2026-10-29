import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { ResponseForm } from "./response-form";
import { RegenerateUrl, RetentionForm } from "./retention-and-url";
import { EndpointSettingsForm } from "./settings-form";
import { SignatureForm } from "./signature-form";

export const metadata: Metadata = {
  title: "Endpoint settings",
  description: "Name, response, signature verification, retention and deletion of an endpoint.",
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
  const canEdit = hasRole(org.role, "member");

  return (
    <PageBody>
      <PageHeader title="Settings" description={endpoint.name} />
      <EndpointSettingsForm
        orgSlug={orgSlug}
        canEdit={canEdit}
        endpoint={{
          slug: endpoint.slug,
          name: endpoint.name,
          description: endpoint.description,
          status: endpoint.status,
        }}
      >
        {canEdit && (
          <section className="grid gap-3">
            <h2 className="font-medium">URL</h2>
            <p className="text-muted-foreground font-mono text-sm break-all">{endpoint.url}</p>
            <RegenerateUrl orgSlug={orgSlug} slug={endpoint.slug} />
          </section>
        )}
        <ResponseForm
          orgSlug={orgSlug}
          slug={endpoint.slug}
          canEdit={canEdit}
          initial={{
            mode: endpoint.responseMode,
            status: endpoint.responseStatus,
            headers: endpoint.responseHeaders,
            body: endpoint.responseBody,
            delayMs: endpoint.responseDelayMs,
            syncTimeoutMs: endpoint.syncTimeoutMs,
          }}
        />
        <SignatureForm
          orgSlug={orgSlug}
          slug={endpoint.slug}
          canEdit={canEdit}
          provider={endpoint.signatureProvider}
          hasSecret={endpoint.hasSignatureSecret}
        />
        <RetentionForm
          orgSlug={orgSlug}
          slug={endpoint.slug}
          canEdit={canEdit}
          hours={endpoint.retentionHours}
          maxHours={org.limits.retention_hours}
          plan={org.limits.name}
        />
      </EndpointSettingsForm>
    </PageBody>
  );
}
