"use client";

import { limitsFor } from "@hookline/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { SearchBox } from "@/components/admin/admin-bits";
import { formatDate, formatNumber } from "@/components/admin/format";
import { Badge } from "@/components/ui/badge";
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

export function OrgsTable() {
  const trpc = useTRPC();
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const query = useInfiniteQuery(
    trpc.admin.orgs.list.infiniteQueryOptions(deferred ? { q: deferred } : {}, {
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-4">
      <SearchBox value={q} onChange={setQ} label="Search by name or URL" />
      <div className="bg-card/30 overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Members</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Endpoints</TableHead>
              <TableHead className="hidden text-right md:table-cell">Requests this month</TableHead>
              <TableHead className="hidden lg:table-cell">Created</TableHead>
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
            {items.map((o) => {
              const plan = o.planOverride ?? o.plan ?? "free";
              return (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/admin/organizations/${o.id}`} className="group block min-w-0">
                      <span className="block truncate font-medium group-hover:underline">
                        {o.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        /{o.slug}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      {limitsFor(plan).name}
                      {o.planOverride && (
                        <Badge variant="outline" className="text-xs">
                          Assigned
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {o.members}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {o.endpoints}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {formatNumber(o.requestsThisMonth)}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                    {formatDate(o.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
            {!query.isPending && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                  No organizations{deferred ? ` match “${deferred}”` : ""}.
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
