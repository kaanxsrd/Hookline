"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDownUp, Pause, Play, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { RelativeTime } from "@/components/inbox/relative-time";
import { Sparkline } from "@/components/sparkline";
import { EndpointStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

type Row = {
  id: string;
  slug: string;
  name: string;
  url: string;
  status: "active" | "paused" | "disabled_by_admin";
  requestCount: number;
  lastRequestAt: string | null;
  last24h: number[];
};

type SortKey = "name" | "lastRequestAt" | "requestCount";

export function EndpointTable({
  orgSlug,
  endpoints,
  canEdit,
}: {
  orgSlug: string;
  endpoints: Row[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "lastRequestAt",
    desc: true,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bulkUpdate = useMutation(trpc.endpoint.bulkUpdate.mutationOptions());
  const bulkDelete = useMutation(trpc.endpoint.bulkDelete.mutationOptions());

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? endpoints.filter(
          (e) => e.name.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q),
        )
      : endpoints;
    const value = (e: Row) =>
      sort.key === "name"
        ? e.name.toLowerCase()
        : sort.key === "requestCount"
          ? e.requestCount
          : (e.lastRequestAt ?? "");
    return [...filtered].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -cmp : cmp;
    });
  }, [endpoints, query, sort]);

  const slugs = [...selected];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.slug));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.slug)));
  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  async function setStatus(status: "active" | "paused") {
    const result = await attempt(bulkUpdate.mutateAsync({ orgSlug, slugs, status }));
    if (!result) {
      toast.error(bulkUpdate.error?.message ?? "Could not update the endpoints");
      return;
    }
    toast.success(
      `${result.updated} ${result.updated === 1 ? "endpoint" : "endpoints"} ${status === "paused" ? "paused" : "resumed"}`,
    );
    setSelected(new Set());
    router.refresh();
  }

  const header = (key: SortKey, label: string, className?: string) => (
    <TableHead className={className}>
      <button
        type="button"
        className="hover:text-foreground inline-flex items-center gap-1"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <ArrowDownUp className="size-3" aria-hidden />
      </button>
    </TableHead>
  );

  if (endpoints.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
        No endpoints yet. Create one to get a URL that captures every request.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search endpoints"
            aria-label="Search endpoints"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {canEdit && selected.size > 0 && (
          <div className="flex items-center gap-2" role="toolbar" aria-label="Bulk actions">
            <span className="text-muted-foreground text-sm">{selected.size} selected</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStatus("paused")}
              disabled={bulkUpdate.isPending}
            >
              <Pause aria-hidden /> Pause
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStatus("active")}
              disabled={bulkUpdate.isPending}
            >
              <Play aria-hidden /> Resume
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          </div>
        )}
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {canEdit && (
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all endpoints"
                  />
                </TableHead>
              )}
              {header("name", "Name")}
              <TableHead className="hidden lg:table-cell">URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Last 24 h</TableHead>
              {header("lastRequestAt", "Last request", "hidden sm:table-cell")}
              {header("requestCount", "Requests", "text-right")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id} data-state={selected.has(e.slug) ? "selected" : undefined}>
                {canEdit && (
                  <TableCell>
                    <Checkbox
                      checked={selected.has(e.slug)}
                      onCheckedChange={() => toggle(e.slug)}
                      aria-label={`Select ${e.name}`}
                    />
                  </TableCell>
                )}
                <TableCell className="max-w-48 font-medium">
                  <Link
                    href={`/${orgSlug}/endpoints/${e.slug}`}
                    className="block truncate hover:underline"
                  >
                    {e.name}
                  </Link>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <span className="flex items-center gap-1">
                    <code className="text-muted-foreground max-w-72 truncate font-mono text-xs">
                      {e.url}
                    </code>
                    <CopyButton value={e.url} label={`Copy URL of ${e.name}`} />
                  </span>
                </TableCell>
                <TableCell>
                  <EndpointStatusBadge status={e.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Sparkline values={e.last24h} label={e.name} />
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-sm sm:table-cell">
                  {e.lastRequestAt ? <RelativeTime iso={e.lastRequestAt} /> : "Never"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.requestCount.toLocaleString("en")}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                  No endpoint matches “{query}”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size} {selected.size === 1 ? "endpoint" : "endpoints"}?
            </DialogTitle>
            <DialogDescription>
              Their URLs stop working and every captured request, destination and delivery is
              deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDelete.isPending}
              onClick={async () => {
                const result = await attempt(
                  bulkDelete.mutateAsync({ orgSlug, slugs, confirm: slugs.length }),
                );
                setConfirmDelete(false);
                if (!result) {
                  toast.error(bulkDelete.error?.message ?? "Could not delete the endpoints");
                  return;
                }
                toast.success(`${result.deleted} deleted`);
                setSelected(new Set());
                router.refresh();
              }}
            >
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
