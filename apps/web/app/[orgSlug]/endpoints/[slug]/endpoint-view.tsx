import { uuidv7 } from "@hookline/db";
import { Route, Send, Settings } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { EndpointStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { EndpointInbox } from "./endpoint-inbox";

/** The endpoint page: header and the live inbox, optionally with a request selected. */
export async function EndpointView({
  orgSlug,
  slug,
  selectedId,
}: {
  orgSlug: string;
  slug: string;
  selectedId: string | undefined;
}) {
  const caller = await api();
  const [org, endpoint, initial] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    load(() => caller.endpoint.get({ orgSlug, slug })),
    load(() => caller.request.list({ orgSlug, endpointSlug: slug, limit: 100 })),
  ]);
  const base = `/${orgSlug}/endpoints/${slug}`;

  return (
    <div className="flex min-h-[calc(100dvh-3.25rem)] flex-col gap-4 p-4 sm:p-6 md:h-dvh md:min-h-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-xl font-semibold tracking-tight">{endpoint.name}</h1>
          <EndpointStatusBadge status={endpoint.status} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`${base}/destinations`}>
              <Send aria-hidden /> Destinations
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`${base}/settings`}>
              <Settings aria-hidden /> Settings
            </Link>
          </Button>
        </div>
      </header>
      <div className="bg-card flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
        <Route className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <code data-testid="endpoint-url" className="min-w-0 flex-1 truncate font-mono text-sm">
          {endpoint.url}
        </code>
        <CopyButton value={endpoint.url} label="Copy endpoint URL" />
      </div>
      {endpoint.status !== "active" && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
          {endpoint.status === "paused"
            ? "This endpoint is paused: senders get 410 and nothing is captured until you resume it."
            : `This endpoint was disabled by an administrator${endpoint.disabledReason ? `: ${endpoint.disabledReason}` : "."}`}
        </p>
      )}
      <EndpointInbox
        orgSlug={orgSlug}
        endpointSlug={slug}
        endpointId={endpoint.id}
        initial={initial}
        since={uuidv7(new Date(Date.now() - 60_000))}
        selectedId={selectedId}
        canReveal={hasRole(org.role, "member")}
        canDelete={hasRole(org.role, "member")}
        appUrl={env().APP_URL}
        tunnels={endpoint.tunnels}
      />
    </div>
  );
}
