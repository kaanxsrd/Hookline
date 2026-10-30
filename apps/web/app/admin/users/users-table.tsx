"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { SearchBox, UserStateBadges } from "@/components/admin/admin-bits";
import { formatDate, formatDateTime } from "@/components/admin/format";
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

export function UsersTable() {
  const trpc = useTRPC();
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const query = useInfiniteQuery(
    trpc.admin.users.list.infiniteQueryOptions(deferred ? { q: deferred } : {}, {
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-4">
      <SearchBox value={q} onChange={setQ} label="Search by name or email" />
      <div className="bg-card/30 overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="hidden sm:table-cell">Organizations</TableHead>
              <TableHead className="hidden md:table-cell">Last active</TableHead>
              <TableHead className="hidden md:table-cell">Joined</TableHead>
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
            {items.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link href={`/admin/users/${u.id}`} className="group block min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium group-hover:underline">{u.name}</span>
                      <UserStateBadges
                        isAdmin={u.isAdmin}
                        disabledAt={u.disabledAt}
                        emailVerified={u.emailVerified}
                      />
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">{u.email}</span>
                  </Link>
                </TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{u.orgs}</TableCell>
                <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                  {formatDateTime(u.lastActiveAt)}
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                  {formatDate(u.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {!query.isPending && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                  No users{deferred ? ` match “${deferred}”` : ""}.
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
