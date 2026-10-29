"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const STATUSES = ["pending", "succeeded", "failed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

const statusStyle: Record<Status, { label: string; className: string }> = {
  succeeded: { label: "Delivered", className: "text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Failed", className: "text-destructive" },
  pending: { label: "Retrying", className: "text-amber-700 dark:text-amber-300" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
};

const ALL = "all";

export function DeliveriesTable({
  orgSlug,
  endpoints,
  canRetry,
  initialStatus,
}: {
  orgSlug: string;
  endpoints: { slug: string; name: string }[];
  canRetry: boolean;
  initialStatus: Status | undefined;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status | typeof ALL>(initialStatus ?? ALL);
  const [endpoint, setEndpoint] = useState<string>(ALL);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const filters = {
    ...(status !== ALL ? { status: [status] } : {}),
    ...(endpoint !== ALL ? { endpointSlug: endpoint } : {}),
  };
  const list = useInfiniteQuery(
    trpc.delivery.list.infiniteQueryOptions(
      { orgSlug, limit: 50, ...filters },
      {
        getNextPageParam: (last) => last.nextCursor,
        // Retries settle in the background; keep the table current.
        refetchInterval: 10_000,
      },
    ),
  );
  const retryable = useQuery(trpc.delivery.retryableCount.queryOptions({ orgSlug, ...filters }));
  const retry = useMutation(trpc.delivery.retry.mutationOptions());
  const bulkRetry = useMutation(trpc.delivery.bulkRetry.mutationOptions());
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.delivery.list.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.delivery.retryableCount.pathKey() }),
    ]);
  }

  async function retryOne(id: string) {
    if (!(await attempt(retry.mutateAsync({ orgSlug, id })))) {
      toast.error(retry.error?.message ?? "Could not retry the delivery.");
      return;
    }
    toast.success("Retry queued");
    await refresh();
  }

  async function retryAll() {
    const res = await attempt(bulkRetry.mutateAsync({ orgSlug, ...filters }));
    setConfirmBulk(false);
    if (!res) {
      toast.error(bulkRetry.error?.message ?? "Could not retry deliveries.");
      return;
    }
    toast.success(`${res.retried} ${res.retried === 1 ? "delivery" : "deliveries"} queued again`);
    await refresh();
  }

  const failedCount = retryable.data?.count ?? 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as Status | typeof ALL)}>
            <SelectTrigger className="w-40" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusStyle[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={endpoint} onValueChange={setEndpoint}>
            <SelectTrigger className="w-52" aria-label="Endpoint">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All endpoints</SelectItem>
              {endpoints.map((e) => (
                <SelectItem key={e.slug} value={e.slug}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canRetry && (
          <Button
            variant="outline"
            onClick={() => setConfirmBulk(true)}
            disabled={failedCount === 0 || bulkRetry.isPending}
          >
            <RotateCcw aria-hidden /> Retry failed{failedCount > 0 ? ` (${failedCount})` : ""}
          </Button>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead className="hidden md:table-cell">Endpoint</TableHead>
              <TableHead className="hidden lg:table-cell">Last result</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending &&
              [0, 1, 2].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {items.map((d) => {
              const style = statusStyle[d.status];
              return (
                <TableRow key={d.id} data-testid="delivery-row">
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    <Link
                      href={`/${orgSlug}/endpoints/${d.endpointSlug}?request=${d.requestId}`}
                      className="hover:underline"
                    >
                      <time dateTime={d.createdAt.toISOString()}>
                        {d.createdAt.toLocaleString()}
                      </time>
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className={cn("text-sm font-medium", style.className)}>
                      {style.label}
                    </span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {d.attemptCount}/{d.maxAttempts}
                    </span>
                    {d.trigger !== "auto" && (
                      <Badge variant="outline" className="ml-2">
                        {d.trigger}
                      </Badge>
                    )}
                    {d.retried && (
                      <Badge variant="secondary" className="ml-2">
                        retried
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <div className="truncate text-sm">{d.destinationName}</div>
                    <div className="text-muted-foreground truncate font-mono text-xs">
                      {d.destinationUrl}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-40 truncate text-sm md:table-cell">
                    {d.endpointName}
                  </TableCell>
                  <TableCell className="hidden max-w-72 lg:table-cell">
                    <span className="font-mono text-xs">{d.lastStatusCode ?? ""}</span>
                    {d.lastError && (
                      <span className="text-muted-foreground ml-2 truncate text-xs">
                        {d.lastError}
                      </span>
                    )}
                    {d.status === "pending" && d.nextAttemptAt && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        next {d.nextAttemptAt.toLocaleTimeString()}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canRetry && d.status !== "pending" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Retry delivery"
                        onClick={() => retryOne(d.id)}
                        disabled={retry.isPending}
                      >
                        <RotateCcw aria-hidden />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!list.isPending && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                  No deliveries
                  {status !== ALL || endpoint !== ALL ? " match these filters" : " yet"}. Add a
                  destination to an endpoint to forward its requests.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {list.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-center"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          Load more
        </Button>
      )}

      <Dialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Retry {Math.min(failedCount, retryable.data?.limit ?? failedCount)} failed{" "}
              {failedCount === 1 ? "delivery" : "deliveries"}?
            </DialogTitle>
            <DialogDescription>
              Each is sent again as a new delivery with a fresh retry schedule.
              {retryable.data && failedCount > retryable.data.limit
                ? ` The ${retryable.data.limit} most recent are retried now; run it again for the rest.`
                : ""}{" "}
              Deliveries whose request is past retention are skipped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBulk(false)}>
              Cancel
            </Button>
            <Button onClick={retryAll} disabled={bulkRetry.isPending}>
              Retry deliveries
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
