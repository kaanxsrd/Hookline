"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp, Inbox as InboxIcon, Pause, Play, Terminal } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatBytes } from "@/lib/body";
import { toCurl } from "@/lib/copy-as";
import { cn } from "@/lib/utils";
import { DeliveryDots, SignatureBadge, StatusCode } from "./badges";
import { FiltersBar, rangeStart, type TimeRange } from "./filters-bar";
import { matchesLive } from "./live-filter";
import { LiveStatusBadge } from "./live-status";
import { MethodChip } from "./method-chip";
import { RelativeTime } from "./relative-time";
import type { ReplayActions } from "./replay-menu";
import { copyable, copyText, type DetailTab, RequestDetail } from "./request-detail";
import type {
  DeliveryStatus,
  RequestDetail as Detail,
  RequestFilter,
  RequestPage,
  RequestSummary,
} from "./types";
import { type StreamAccess, useRequestStream } from "./use-request-stream";

/** Where an inbox gets its data: tRPC for members, server actions for anonymous viewers. */
export type InboxSource = {
  /** Distinguishes cached queries between endpoints. */
  key: string;
  list: (filter: RequestFilter, cursor: string | undefined) => Promise<RequestPage>;
  get: (id: string, reveal: boolean) => Promise<Detail | null>;
  streamAccess: () => Promise<StreamAccess>;
  remove?: ((id: string) => Promise<void>) | undefined;
  /** Sends a delivery's request to its destination again (members only). */
  retryDelivery?: ((deliveryId: string) => Promise<void>) | undefined;
  /** Replays requests to destinations or CLIs (members only). */
  replay?: ReplayActions | undefined;
  bodyUrl: (id: string) => string;
  permalink?: ((id: string) => string) | undefined;
  canReveal: boolean;
};

type Props = {
  source: InboxSource;
  initial: RequestPage;
  /** A UUIDv7 from before the page rendered: the live stream's resume point. */
  since: string;
  initialSelectedId?: string | undefined;
  onResync?: () => void;
  /** Connected CLI tunnels when the page rendered; omitted where tunnels do not apply. */
  initialTunnels?: number | undefined;
};

const ROW_HEIGHT = 52;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(
    el?.closest("input, textarea, select, [contenteditable=true], [role=menu], [role=dialog]"),
  );
}

export function Inbox({
  source,
  initial,
  since,
  initialSelectedId,
  onResync,
  initialTunnels,
}: Props) {
  const [tunnels, setTunnels] = useState(initialTunnels);
  const [replayOpen, setReplayOpen] = useState(false);
  const queryClient = useQueryClient();
  const [filterState, setFilter] = useState<RequestFilter>({});
  const [range, setRange] = useState<TimeRange>("all");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const filter = useMemo<RequestFilter>(() => {
    const from = rangeStart(range);
    return { ...filterState, ...(q ? { q } : {}), ...(from ? { from } : {}) };
  }, [filterState, q, range]);
  const unfiltered = Object.values(filter).every((v) => v === undefined);

  const pages = useInfiniteQuery({
    queryKey: ["inbox", source.key, filter],
    queryFn: ({ pageParam }) => source.list(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    ...(unfiltered ? { initialData: { pages: [initial], pageParams: [undefined] } } : {}),
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Every live request since the page loaded, newest first, whatever the
  // filter: switching filters never loses one. Display filters them.
  const [live, setLive] = useState<RequestSummary[]>([]);
  // Live requests held back while paused or scrolled away from the top.
  const [held, setHeld] = useState<RequestSummary[]>([]);
  // Requests that arrived during a search (live events cannot be searched).
  const [unmatched, setUnmatched] = useState(0);
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryStatus[]>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const [atTop, setAtTop] = useState(true);

  const filterKey = JSON.stringify(filter);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the filter changes; its value is not read
  useEffect(() => setUnmatched(0), [filterKey]);

  const holding = paused || !atTop;
  const onRequest = useCallback(
    (s: RequestSummary) => {
      if (filter.q) setUnmatched((n) => n + 1);
      (holding ? setHeld : setLive)((prev) =>
        prev.some((p) => p.id === s.id) ? prev : [s, ...prev],
      );
    },
    [filter.q, holding],
  );

  const status = useRequestStream({
    getAccess: source.streamAccess,
    since: initial.items[0]?.id ?? since,
    onRequest,
    onDelivery: (e) => {
      setDeliveries((prev) => ({ ...prev, [e.request_id]: e.statuses }));
      queryClient.invalidateQueries({ queryKey: ["inbox-detail", source.key, e.request_id] });
    },
    ...(onResync ? { onResync } : {}),
    onTunnels: setTunnels,
  });

  const heldVisible = useMemo(() => held.filter((s) => matchesLive(s, filter)), [held, filter]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: RequestSummary[] = [];
    const visibleLive = live.filter((s) => matchesLive(s, filter));
    for (const r of [...visibleLive, ...(pages.data?.pages.flatMap((p) => p.items) ?? [])]) {
      if (seen.has(r.id) || removed.has(r.id)) continue;
      seen.add(r.id);
      const updated = deliveries[r.id];
      out.push(updated ? { ...r, deliveries: updated } : r);
    }
    return out;
  }, [live, filter, pages.data, deliveries, removed]);

  // Selection lives in ?request= without a server round trip.
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);
  const select = useCallback((id: string | undefined) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("request", id);
    else url.searchParams.delete("request");
    window.history.replaceState(null, "", url);
  }, []);

  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const reveal = selectedId ? revealed.has(selectedId) : false;
  const detail = useQuery({
    queryKey: ["inbox-detail", source.key, selectedId, reveal],
    queryFn: () => (selectedId ? source.get(selectedId, reveal) : null),
    enabled: Boolean(selectedId),
    // Revealing refetches the same request: keep showing it meanwhile.
    placeholderData: (previous) => (previous?.id === selectedId ? previous : undefined),
  });
  // The open tab survives moving between requests and revealing headers.
  const [tab, setTab] = useState<DetailTab>("body");

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const hasMore = Boolean(pages.hasNextPage);
  const virtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (hasMore && lastIndex >= rows.length - 1 && !pages.isFetchingNextPage) pages.fetchNextPage();
  }, [hasMore, lastIndex, rows.length, pages]);

  const showHeld = useCallback(() => {
    setLive((prev) => [...held.filter((h) => !prev.some((p) => p.id === h.id)), ...prev]);
    setHeld([]);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [held]);

  // When the viewer returns to the top (and is not paused), show what was held.
  useEffect(() => {
    if (!holding && held.length > 0) {
      setLive((prev) => [...held.filter((h) => !prev.some((p) => p.id === h.id)), ...prev]);
      setHeld([]);
    }
  }, [holding, held]);

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const index = rows.findIndex((r) => r.id === selectedId);
      const next = Math.min(rows.length - 1, Math.max(0, index === -1 ? 0 : index + delta));
      const row = rows[next];
      if (!row) return;
      select(row.id);
      virtualizer.scrollToIndex(next, { align: "auto" });
    },
    [rows, selectedId, select, virtualizer],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      switch (e.key) {
        case "j":
          move(1);
          break;
        case "k":
          move(-1);
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "p":
          setPaused((p) => !p);
          break;
        case "c":
          if (detail.data) copyText(toCurl(copyable(detail.data)), "as cURL");
          break;
        case "r":
          if (detail.data && source.replay) {
            e.preventDefault();
            setReplayOpen(true);
          }
          break;
        case "Escape":
          select(undefined);
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, detail.data, select, source.replay]);

  const wide = useMediaQuery("(min-width: 1024px)");
  const detailPane = selectedId ? (
    detail.data ? (
      <RequestDetail
        detail={detail.data}
        tab={tab}
        onTabChange={setTab}
        downloadUrl={source.bodyUrl(detail.data.id)}
        permalink={source.permalink?.(detail.data.id)}
        canReveal={source.canReveal}
        replay={source.replay}
        replayOpen={replayOpen}
        onReplayOpenChange={setReplayOpen}
        onRetryDelivery={
          source.retryDelivery
            ? async (deliveryId) => {
                try {
                  await source.retryDelivery?.(deliveryId);
                  toast.success("Retry queued");
                  queryClient.invalidateQueries({
                    queryKey: ["inbox-detail", source.key, detail.data?.id],
                  });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not retry");
                }
              }
            : undefined
        }
        onReveal={async () => {
          if (selectedId) setRevealed((s) => new Set(s).add(selectedId));
        }}
        onDelete={
          source.remove
            ? async () => {
                const id = detail.data?.id;
                if (!id || !source.remove) return;
                try {
                  await source.remove(id);
                  setRemoved((s) => new Set(s).add(id));
                  select(undefined);
                  toast.success("Request deleted");
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Could not delete the request",
                  );
                }
              }
            : undefined
        }
      />
    ) : detail.isPending ? (
      <div className="grid gap-3 p-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    ) : (
      <p className="text-muted-foreground p-6 text-sm">This request is no longer available.</p>
    )
  ) : (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
      <InboxIcon className="size-8" aria-hidden />
      Select a request to inspect it.
      <span className="text-xs">
        <kbd className="bg-muted rounded px-1">j</kbd>/
        <kbd className="bg-muted rounded px-1">k</kbd> to move,{" "}
        <kbd className="bg-muted rounded px-1">c</kbd> copies cURL,{" "}
        <kbd className="bg-muted rounded px-1">p</kbd> pauses.
      </span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <FiltersBar
            filter={filterState}
            range={range}
            search={search}
            searchRef={searchRef}
            onSearch={setSearch}
            onChange={setFilter}
            onRange={setRange}
          />
        </div>
        <div className="flex items-center gap-2">
          {tunnels !== undefined && (
            <span
              data-testid="cli-count"
              title="CLI tunnels connected (hookline listen)"
              className="text-muted-foreground inline-flex items-center gap-1 text-xs"
            >
              <Terminal className="size-3.5" aria-hidden />
              {tunnels} CLI
            </span>
          )}
          <LiveStatusBadge status={paused ? "reconnecting" : status} />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            title="Pause live updates (p)"
          >
            {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-lg border lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <div className="relative flex min-h-0 flex-col lg:border-r">
          {(heldVisible.length > 0 || unmatched > 0) && (
            <button
              type="button"
              onClick={heldVisible.length > 0 ? showHeld : () => setSearch("")}
              className="bg-primary text-primary-foreground absolute top-2 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium shadow"
            >
              <ArrowUp className="size-3" aria-hidden />
              {heldVisible.length > 0
                ? `${heldVisible.length} new`
                : `${unmatched} new, clear search to see them`}
            </button>
          )}
          <div
            ref={scrollRef}
            onScroll={(e) => setAtTop(e.currentTarget.scrollTop < 8)}
            className="min-h-[300px] flex-1 overflow-auto"
            role="listbox"
            aria-label="Captured requests"
            data-testid="request-list"
          >
            {rows.length === 0 ? (
              <div className="text-muted-foreground p-8 text-center text-sm">
                {pages.isFetching
                  ? "Loading…"
                  : unfiltered
                    ? "Waiting for the first request. It appears here instantly."
                    : "No request matches these filters."}
              </div>
            ) : (
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {items.map((item) => {
                  const r = rows[item.index];
                  return (
                    <div
                      key={item.key}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: item.size,
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      {r ? (
                        <Row
                          summary={r}
                          selected={r.id === selectedId}
                          onSelect={() => select(r.id)}
                        />
                      ) : (
                        <div className="text-muted-foreground p-4 text-center text-xs">
                          Loading more…
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <p
            className="text-muted-foreground border-t px-3 py-1.5 text-xs"
            data-testid="request-count"
          >
            {rows.length}
            {hasMore ? "+" : ""} {rows.length === 1 ? "request" : "requests"}
          </p>
        </div>

        {wide ? (
          <div className="hidden min-h-0 lg:block">{detailPane}</div>
        ) : (
          <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && select(undefined)}>
            <SheetContent side="right" className="w-full p-0 sm:max-w-xl">
              <SheetTitle className="sr-only">Request detail</SheetTitle>
              {detailPane}
            </SheetContent>
          </Sheet>
        )}
      </div>
    </div>
  );
}

function Row({
  summary: r,
  selected,
  onSelect,
}: {
  summary: RequestSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      data-testid="request-row"
      data-request-id={r.id}
      className={cn(
        "flex h-full w-full items-center gap-3 border-b px-3 text-left text-sm",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <MethodChip method={r.method} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs">{r.path}</span>
        <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
          <StatusCode code={r.response_status} />
          <span>{formatBytes(r.body_size)}</span>
          <SignatureBadge status={r.signature_status} compact />
          <DeliveryDots statuses={r.deliveries} />
        </span>
      </span>
      <RelativeTime iso={r.received_at} className="text-muted-foreground shrink-0 text-xs" />
    </button>
  );
}
