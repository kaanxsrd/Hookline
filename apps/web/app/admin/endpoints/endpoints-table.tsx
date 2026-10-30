"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useDeferredValue, useId, useState } from "react";
import { SearchBox, useAdminAction } from "@/components/admin/admin-bits";
import { formatDateTime, formatNumber } from "@/components/admin/format";
import { EndpointStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc/client";

type Status = "all" | "disabled" | "anonymous";
type Target = { id: string; slug: string; name: string };

export function EndpointsTable({
  initialQuery,
  initialStatus,
}: {
  initialQuery: string;
  initialStatus: Status;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [disabling, setDisabling] = useState<Target | null>(null);
  const deferred = useDeferredValue(q.trim());
  const query = useInfiniteQuery(
    trpc.admin.endpoints.list.infiniteQueryOptions(
      { status, ...(deferred ? { q: deferred } : {}) },
      { getNextPageParam: (last) => last.nextCursor },
    ),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const enable = useMutation(trpc.admin.endpoints.enable.mutationOptions());
  const { run, pending } = useAdminAction();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.admin.endpoints.list.pathKey() });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={setQ} label="Search by slug or name" />
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger className="w-44" aria-label="Show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All endpoints</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="anonymous">Temporary</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="bg-card/30 overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Endpoint</TableHead>
              <TableHead className="hidden sm:table-cell">Owner</TableHead>
              <TableHead className="hidden text-right md:table-cell">Requests</TableHead>
              <TableHead className="hidden lg:table-cell">Last request</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending &&
              [0, 1, 2].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="max-w-64">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="text-muted-foreground block font-mono text-xs">{e.slug}</span>
                  {e.disabledReason && (
                    <span
                      className="text-destructive block truncate text-xs"
                      title={e.disabledReason}
                    >
                      {e.disabledReason}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-sm sm:table-cell">
                  {e.orgId ? (
                    <Link href={`/admin/organizations/${e.orgId}`} className="hover:underline">
                      {e.orgName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">
                      Temporary · expires {formatDateTime(e.expiresAt)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {formatNumber(e.requestCount)}
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                  {formatDateTime(e.lastRequestAt)}
                </TableCell>
                <TableCell>
                  <EndpointStatusBadge status={e.status} />
                </TableCell>
                <TableCell className="text-right">
                  {e.status === "disabled_by_admin" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={async () => {
                        if (
                          await run(() => enable.mutateAsync({ id: e.id }), `${e.slug} is enabled`)
                        ) {
                          await refresh();
                        }
                      }}
                    >
                      Enable
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDisabling({ id: e.id, slug: e.slug, name: e.name })}
                    >
                      Disable
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!query.isPending && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                  No endpoints{deferred ? ` match “${deferred}”` : ""}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-center"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Load more
        </Button>
      )}
      <DisableDialog target={disabling} onClose={() => setDisabling(null)} onDone={refresh} />
    </div>
  );
}

function DisableDialog({
  target,
  onClose,
  onDone,
}: {
  target: Target | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const id = useId();
  const trpc = useTRPC();
  const disable = useMutation(trpc.admin.endpoints.disable.mutationOptions());
  const { run, pending } = useAdminAction();
  const [reason, setReason] = useState("");

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!target) return;
            const ok = await run(
              () => disable.mutateAsync({ id: target.id, reason: reason.trim() }),
              `${target.slug} is disabled`,
            );
            if (ok) {
              setReason("");
              onClose();
              await onDone();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Disable {target?.name}?</DialogTitle>
            <DialogDescription>
              Intake answers <code>410 endpoint_disabled</code> right away, and the owners cannot
              turn it back on. Captured requests are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-reason`}>Reason</Label>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Shown to the organization, e.g. Hosting a phishing page."
              minLength={3}
              maxLength={500}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
            >
              Disable endpoint
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
