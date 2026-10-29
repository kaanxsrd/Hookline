"use client";

import { useState, useTransition } from "react";
import { formatBytes } from "@/lib/body";
import { LiveStatusBadge } from "./live-status";
import { MethodChip } from "./method-chip";
import { RelativeTime } from "./relative-time";
import { RequestDetailPanel } from "./request-detail-panel";
import type { RequestDetail, RequestSummary } from "./types";
import { type StreamAccess, useLiveRequests } from "./use-live-requests";

type Props = {
  initial: RequestSummary[];
  /** See useLiveRequests. */
  since: string;
  getAccess: () => Promise<StreamAccess>;
  loadDetail: (id: string) => Promise<RequestDetail | null>;
  onResync?: () => void;
  emptyText?: string;
};

/** A live, newest-first list of captured requests whose rows expand into details. */
export function LiveRequestList({
  initial,
  since,
  getAccess,
  loadDetail,
  onResync,
  emptyText,
}: Props) {
  const { requests, status } = useLiveRequests({
    initial,
    since,
    getAccess,
    ...(onResync ? { onResync } : {}),
  });

  return (
    <section>
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
          {emptyText ?? "Waiting for the first request. It appears here instantly."}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {requests.map((r) => (
            <RequestRow key={r.id} summary={r} loadDetail={loadDetail} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestRow({
  summary: r,
  loadDetail,
}: {
  summary: RequestSummary;
  loadDetail: (id: string) => Promise<RequestDetail | null>;
}) {
  const [detail, setDetail] = useState<RequestDetail | null | "missing">(null);
  const [pending, startTransition] = useTransition();

  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || detail !== null) return;
    startTransition(async () => {
      setDetail((await loadDetail(r.id)) ?? "missing");
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
