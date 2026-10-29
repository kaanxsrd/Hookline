import { uuidv7 } from "@hookline/db";
import { Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { PageBody, PageHeader } from "@/components/page-header";
import { EndpointStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api, load } from "@/lib/trpc/server";
import { EndpointInbox } from "./endpoint-inbox";

type Props = { params: Promise<{ orgSlug: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, slug } = await params;
  const endpoint = await load(async () => (await api()).endpoint.get({ orgSlug, slug }));
  return { title: endpoint.name, description: `Live inbox of ${endpoint.name}.` };
}

export default async function EndpointPage({ params }: Props) {
  const { orgSlug, slug } = await params;
  const caller = await api();
  const [endpoint, page] = await Promise.all([
    load(() => caller.endpoint.get({ orgSlug, slug })),
    load(() => caller.request.list({ orgSlug, endpointSlug: slug })),
  ]);

  return (
    <PageBody wide>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {endpoint.name} <EndpointStatusBadge status={endpoint.status} />
          </span>
        }
        description={endpoint.description || undefined}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/${orgSlug}/endpoints/${slug}/settings`}>
              <Settings aria-hidden /> Settings
            </Link>
          </Button>
        }
      />
      <div className="bg-card mb-8 flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
        <code data-testid="endpoint-url" className="min-w-0 flex-1 truncate font-mono text-sm">
          {endpoint.url}
        </code>
        <CopyButton value={endpoint.url} label="Copy endpoint URL" />
      </div>
      {endpoint.status !== "active" && (
        <p className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {endpoint.status === "paused"
            ? "This endpoint is paused: senders get 410 and nothing is captured until you resume it."
            : `This endpoint was disabled by an administrator${endpoint.disabledReason ? `: ${endpoint.disabledReason}` : "."}`}
        </p>
      )}
      <EndpointInbox
        orgSlug={orgSlug}
        endpointSlug={slug}
        endpointId={endpoint.id}
        initial={page.items}
        since={uuidv7(new Date(Date.now() - 60_000))}
      />
    </PageBody>
  );
}
