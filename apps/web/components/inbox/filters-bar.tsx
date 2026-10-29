"use client";

import { ChevronDown, Search, X } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RequestFilter } from "./types";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const SIGNATURES = ["verified", "invalid", "unchecked"] as const;
const DELIVERIES = ["succeeded", "failed", "pending", "none"] as const;
const RANGES = [
  { value: "all", label: "Any time" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
] as const;

export type TimeRange = (typeof RANGES)[number]["value"];

export function rangeStart(range: TimeRange): string | undefined {
  const hours = { all: 0, "1h": 1, "24h": 24, "7d": 168 }[range];
  return hours ? new Date(Date.now() - hours * 3_600_000).toISOString() : undefined;
}

type Props = {
  filter: RequestFilter;
  range: TimeRange;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearch: (q: string) => void;
  onChange: (filter: RequestFilter) => void;
  onRange: (range: TimeRange) => void;
};

function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const next = list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value];
  return next.length ? next : undefined;
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  selected: T[] | undefined;
  onToggle: (value: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          {label}
          {selected?.length ? (
            <span className="bg-primary/15 text-primary rounded px-1 text-xs">
              {selected.length}
            </span>
          ) : null}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o}
            checked={selected?.includes(o) ?? false}
            onCheckedChange={() => onToggle(o)}
            onSelect={(e) => e.preventDefault()}
            className="capitalize"
          >
            {o}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FiltersBar({
  filter,
  range,
  search,
  searchRef,
  onSearch,
  onChange,
  onRange,
}: Props) {
  const active = Boolean(
    filter.methods || filter.signature || filter.delivery || range !== "all" || search,
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 flex-1">
        <Search
          className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search path and body  ( / )"
          aria-label="Search requests"
          className="h-8 pl-8"
        />
      </div>
      <MultiSelect
        label="Method"
        options={METHODS}
        selected={filter.methods}
        onToggle={(m) => onChange({ ...filter, methods: toggle(filter.methods, m) })}
      />
      <MultiSelect
        label="Signature"
        options={SIGNATURES}
        selected={filter.signature}
        onToggle={(s) => onChange({ ...filter, signature: toggle(filter.signature, s) })}
      />
      <MultiSelect
        label="Delivery"
        options={DELIVERIES}
        selected={filter.delivery}
        onToggle={(s) => onChange({ ...filter, delivery: toggle(filter.delivery, s) })}
      />
      <Select value={range} onValueChange={(v) => onRange(v as TimeRange)}>
        <SelectTrigger size="sm" className="h-8 w-36" aria-label="Time range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => {
            onSearch("");
            onRange("all");
            onChange({});
          }}
        >
          <X aria-hidden /> Clear
        </Button>
      )}
    </div>
  );
}
