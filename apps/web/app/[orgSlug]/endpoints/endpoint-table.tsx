"use client";

import { ArrowDownUp, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { RelativeTime } from "@/components/inbox/relative-time";
import { EndpointStatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  id: string;
  slug: string;
  name: string;
  url: string;
  status: "active" | "paused" | "disabled_by_admin";
  requestCount: number;
  lastRequestAt: string | null;
};

type SortKey = "name" | "lastRequestAt" | "requestCount";

export function EndpointTable({ orgSlug, endpoints }: { orgSlug: string; endpoints: Row[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "lastRequestAt",
    desc: true,
  });

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
      <div className="relative max-w-xs">
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
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {header("name", "Name")}
              <TableHead className="hidden md:table-cell">URL</TableHead>
              <TableHead>Status</TableHead>
              {header("lastRequestAt", "Last request", "hidden sm:table-cell")}
              {header("requestCount", "Requests", "text-right")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="max-w-48 font-medium">
                  <Link
                    href={`/${orgSlug}/endpoints/${e.slug}`}
                    className="block truncate hover:underline"
                  >
                    {e.name}
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
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
                <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                  No endpoint matches “{query}”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
