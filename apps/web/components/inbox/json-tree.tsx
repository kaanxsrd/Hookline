"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const PAGE = 100;

/** `$.data.object["weird key"][0]` */
export function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

async function copyPath(path: string) {
  try {
    await navigator.clipboard.writeText(path);
    toast.success(`Copied ${path}`);
  } catch {
    // Clipboard denied; nothing to do.
  }
}

/** A collapsible JSON tree. Clicking a key copies its JSONPath. */
export function JsonTree({ value }: { value: Json }) {
  return (
    <section aria-label="JSON body" className="font-mono text-xs leading-5">
      <Node name={null} value={value} path="$" depth={0} />
    </section>
  );
}

function Node({
  name,
  value,
  path,
  depth,
}: {
  name: string | number | null;
  value: Json;
  path: string;
  depth: number;
}) {
  const container = value !== null && typeof value === "object";
  // Big payloads open two levels deep; the rest is one click away.
  const [open, setOpen] = useState(depth < 2);
  const [limit, setLimit] = useState(PAGE);

  const label =
    name === null ? null : (
      <button
        type="button"
        onClick={() => copyPath(path)}
        title={`Copy ${path}`}
        className="text-sky-700 hover:underline dark:text-sky-300"
      >
        {typeof name === "number" ? name : JSON.stringify(name)}
      </button>
    );

  if (!container) {
    return (
      <div className="pl-4">
        {label}
        {label && <span className="text-muted-foreground">: </span>}
        <Primitive value={value} />
      </div>
    );
  }

  const entries: [string | number, Json][] = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value);
  const [openBracket, closeBracket] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  return (
    <div>
      <div className="flex items-start">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
          className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </button>
        <span>
          {label}
          {label && <span className="text-muted-foreground">: </span>}
          <span className="text-muted-foreground">{openBracket}</span>
          {!open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-muted-foreground px-1 hover:underline"
            >
              {entries.length} {Array.isArray(value) ? "items" : "keys"}
            </button>
          )}
          {!open && <span className="text-muted-foreground">{closeBracket}</span>}
        </span>
      </div>
      {open && (
        <div className="border-border ml-1.5 border-l pl-2">
          {entries.slice(0, limit).map(([k, v]) => (
            <Node key={k} name={k} value={v} path={childPath(path, k)} depth={depth + 1} />
          ))}
          {entries.length > limit && (
            <button
              type="button"
              onClick={() => setLimit(limit + PAGE)}
              className="text-primary pl-4 hover:underline"
            >
              Show {Math.min(PAGE, entries.length - limit)} more of {entries.length - limit}
            </button>
          )}
          <div className="text-muted-foreground pl-0">{closeBracket}</div>
        </div>
      )}
    </div>
  );
}

function Primitive({ value }: { value: null | boolean | number | string }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === "string") {
    return (
      <span className="break-all text-emerald-700 dark:text-emerald-300">
        {JSON.stringify(value)}
      </span>
    );
  }
  if (typeof value === "number")
    return <span className="text-amber-700 dark:text-amber-300">{value}</span>;
  return <span className="text-indigo-700 dark:text-indigo-300">{String(value)}</span>;
}
