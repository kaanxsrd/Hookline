"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc/client";

export function AuditLogTable({ orgSlug }: { orgSlug: string }) {
  const trpc = useTRPC();
  const [action, setAction] = useState("");
  const deferred = useDeferredValue(action.trim());
  const query = useInfiniteQuery(
    trpc.audit.list.infiniteQueryOptions(
      { orgSlug, limit: 50, ...(deferred ? { action: deferred } : {}) },
      { getNextPageParam: (last) => last.nextCursor },
    ),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const exportUrl = `/api/orgs/${orgSlug}/audit-log${deferred ? `?action=${encodeURIComponent(deferred)}` : ""}`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            className="pl-8"
            placeholder="Filter by action, e.g. endpoint."
            aria-label="Filter by action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        </div>
        <Button variant="outline" asChild>
          <a href={exportUrl} download>
            <Download aria-hidden /> Export CSV
          </a>
        </Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden md:table-cell">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending &&
              [0, 1, 2].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                  <time dateTime={e.createdAt.toISOString()}>{e.createdAt.toLocaleString()}</time>
                </TableCell>
                <TableCell className="max-w-40 truncate text-sm">
                  {e.actorName ?? (e.actorApiKeyId ? "API key" : "System")}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.action}</TableCell>
                <TableCell className="text-muted-foreground hidden max-w-md truncate font-mono text-xs md:table-cell">
                  {Object.entries(e.metadata)
                    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
                    .join(" ")}
                </TableCell>
              </TableRow>
            ))}
            {!query.isPending && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                  No entries{deferred ? ` for “${deferred}”` : ""}.
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
    </div>
  );
}
