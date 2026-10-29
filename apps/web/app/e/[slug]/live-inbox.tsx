"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LiveStatusBadge } from "@/components/inbox/live-status";
import { MethodChip } from "@/components/inbox/method-chip";
import { RelativeTime } from "@/components/inbox/relative-time";
import { RequestDetailPanel } from "@/components/inbox/request-detail-panel";
import type { RequestDetail, RequestSummary } from "@/components/inbox/types";
import { useLiveRequests } from "@/components/inbox/use-live-requests";
import { formatBytes } from "@/lib/body";
import { anonymousRequestDetail, anonymousStreamAccess } from "./actions";

type Props = {
  slug: string;
  /** The share-link token when the page was opened through one. */
  shareToken: string | undefined;
  initial: RequestSummary[];
};

export function LiveInbox({ slug, shareToken, initial }: Props) {
  const router = useRouter();
  const { requests, status } = useLiveRequests({
    initial,
    getAccess: () => anonymousStreamAccess(slug, shareToken),
    onResync: () => router.refresh(),
  });

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">
          Requests{" "}
          <span className="text-muted-foreground font-normal" data-testid="request-count">
            ({requests.length})
          </span>
        </h2>
        <LiveStatusBadge status={status} />
      </div>
      {requests.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
          Waiting for the first request. Send one to the URL above; it appears here instantly.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {requests.map((r) => (
            <RequestRow key={r.id} summary={r} slug={slug} shareToken={shareToken} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestRow({
  summary: r,
  slug,
  shareToken,
}: {
  summary: RequestSummary;
  slug: string;
  shareToken: string | undefined;
}) {
  const [detail, setDetail] = useState<RequestDetail | null | "missing">(null);
  const [pending, startTransition] = useTransition();

  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || detail !== null) return;
    startTransition(async () => {
      setDetail((await anonymousRequestDetail(slug, shareToken, r.id)) ?? "missing");
    });
  }

  return (
    <li data-testid="request-row" data-request-id={r.id}>
      <details onToggle={onToggle}>
        <summary className="hover:bg-accent/50 flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm">
          <MethodChip method={r.method} />
          <span className="min-w-0 flex-1 truncate font-mono">{r.path}</span>
          <span className="text-muted-foreground hidden font-mono text-xs sm:inline">
            {formatBytes(r.body_size)}
          </span>
          <RelativeTime
            iso={r.received_at}
            className="text-muted-foreground w-16 text-right text-xs"
          />
        </summary>
        {pending && <p className="text-muted-foreground border-t px-4 py-3 text-sm">Loading…</p>}
        {detail === "missing" && (
          <p className="text-muted-foreground border-t px-4 py-3 text-sm">
            This request is no longer available.
          </p>
        )}
        {detail && detail !== "missing" && <RequestDetailPanel detail={detail} />}
      </details>
    </li>
  );
}
