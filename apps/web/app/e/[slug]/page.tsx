import { uuidv7 } from "@hookline/db";
import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { resolveAnonymousAccess } from "@/lib/anonymous";
import { getDb } from "@/lib/db";
import { env, intakeUrl } from "@/lib/env";
import { listRequests } from "@/lib/requests";
import { LiveInbox } from "./live-inbox";

export const metadata: Metadata = {
  title: "Temporary inbox",
  description: "Requests captured by a temporary Hookline endpoint, live.",
  robots: { index: false },
};

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string | string[]; request?: string | string[] }>;
};

export default async function AnonymousInboxPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { t, request } = await searchParams;
  const shareToken = typeof t === "string" ? t : undefined;

  const access = await resolveAnonymousAccess(slug, shareToken);
  if (!access) notFound();
  const { endpoint, token } = access;

  const initial = await listRequests(
    getDb(),
    { id: endpoint.id, slug, createdAt: endpoint.createdAt },
    { limit: 100 },
  );

  const url = intakeUrl(slug);
  const shareUrl = `${env().APP_URL}/e/${slug}?t=${encodeURIComponent(token)}`;
  const curl = `curl -X POST '${url}' -H 'Content-Type: application/json' -d '{"hello":"world"}'`;
  const hoursLeft = Math.max(0, Math.ceil((endpoint.expiresAt.getTime() - Date.now()) / 3_600_000));

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Your temporary endpoint</h1>
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
            <Clock className="size-4" aria-hidden />
            Expires in {hoursLeft} {hoursLeft === 1 ? "hour" : "hours"}
          </span>
        </div>

        <div className="bg-card flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
          <code data-testid="endpoint-url" className="min-w-0 flex-1 truncate font-mono text-sm">
            {url}
          </code>
          <CopyButton value={url} label="Copy endpoint URL" />
        </div>

        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">Send a test request</summary>
          <div className="bg-card mt-2 flex items-start gap-2 rounded-lg border py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 py-1.5 font-mono text-xs break-all">{curl}</code>
            <CopyButton value={curl} label="Copy curl command" />
          </div>
        </details>

        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">Share this inbox</summary>
          <p className="text-muted-foreground mt-2">
            Anyone with this link can read the captured requests.
          </p>
          <div className="bg-card mt-2 flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{shareUrl}</code>
            <CopyButton value={shareUrl} label="Copy share link" />
          </div>
        </details>
      </header>

      <LiveInbox
        slug={slug}
        shareToken={shareToken}
        isCreator={shareToken === undefined}
        initial={initial}
        since={uuidv7(new Date(Date.now() - 60_000))}
        selectedId={typeof request === "string" ? request : undefined}
      />
    </main>
  );
}
