"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { SearchBox } from "@/components/admin/admin-bits";
import { formatDateTime } from "@/components/admin/format";
import { Button } from "@/components/ui/button";
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

export function AdminAuditTable() {
  const trpc = useTRPC();
  const [action, setAction] = useState("");
  const deferred = useDeferredValue(action.trim());
  const query = useInfiniteQuery(
    trpc.admin.auditLog.infiniteQueryOptions(deferred ? { action: deferred } : {}, {
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-4">
      <SearchBox value={action} onChange={setAction} label="Filter by action, e.g. admin.user" />
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
                  <time dateTime={e.createdAt.toISOString()}>{formatDateTime(e.createdAt)}</time>
                </TableCell>
                <TableCell className="max-w-48 truncate text-sm" title={e.actorEmail ?? undefined}>
                  {e.actorName ?? "Command line"}
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
