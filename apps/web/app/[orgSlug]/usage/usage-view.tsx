"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { CircleAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/body";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import type { AppRouter } from "@/server/routers/_app";

type Usage = inferRouterOutputs<AppRouter>["usage"]["get"];

const fmt = new Intl.NumberFormat("en-US");

/** A metric against its limit, with a bar; status color only with an icon and words. */
function Meter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const state = !limit ? "ok" : used >= limit ? "over" : ratio >= 0.8 ? "near" : "ok";
  return (
    <div
      className="bg-card/30 grid gap-3 rounded-xl border p-5"
      data-testid={`meter-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span className="text-muted-foreground text-xs">{label}</span>
      <p className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {fmt.format(used)}
        </span>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {unit ? `${unit} ` : ""}
          {limit === null ? "· unlimited" : `of ${fmt.format(limit)}`}
        </span>
      </p>
      {limit !== null && (
        <div
          className="bg-muted h-1.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
        >
          <div
            className={cn(
              "h-full rounded-full",
              state === "over"
                ? "bg-destructive"
                : state === "near"
                  ? "bg-amber-500"
                  : "bg-primary",
            )}
            style={{ width: `${Math.max(ratio * 100, used > 0 ? 1 : 0)}%` }}
          />
        </div>
      )}
      {state === "near" && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="size-3.5" aria-hidden /> Over 80% used
        </p>
      )}
      {state === "over" && (
        <p className="text-destructive flex items-center gap-1.5 text-xs">
          <CircleAlert className="size-3.5" aria-hidden /> Limit reached
        </p>
      )}
    </div>
  );
}

/** Requests per day: one series, one hue, hover for exact values, table for screen readers. */
function DailyChart({ daily }: { daily: Usage["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...daily.map((d) => d.requests));
  const width = 640;
  const height = 160;
  const gap = 2;
  const bar = Math.max(2, (width - gap * (daily.length - 1)) / Math.max(1, daily.length));
  const hovered = hover !== null ? daily[hover] : undefined;
  const label = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <section className="bg-card/30 grid gap-4 rounded-xl border p-5" aria-labelledby="daily-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="daily-title" className="text-sm font-medium">
          Requests per day
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)}>
          {table ? "Show chart" : "Show table"}
        </Button>
      </div>
      {table ? (
        <table className="w-full max-w-sm text-sm">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="py-1 font-normal">Day (UTC)</th>
              <th className="py-1 text-right font-normal">Requests</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.day} className="border-t">
                <td className="py-1">{label(d.day)}</td>
                <td className="py-1 text-right tabular-nums">{fmt.format(d.requests)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height + 20}`}
            className="w-full"
            role="img"
            aria-label={`Requests per day this month, peaking at ${fmt.format(max)}`}
            onMouseLeave={() => setHover(null)}
          >
            <line
              x1={0}
              x2={width}
              y1={height}
              y2={height}
              className="stroke-border"
              strokeWidth={1}
            />
            {daily.map((d, i) => {
              const h = d.requests === 0 ? 0 : Math.max(3, (d.requests / max) * (height - 8));
              const x = i * (bar + gap);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover only adds a tooltip; the table view carries the same values for keyboards and screen readers
                <g key={d.day} onMouseEnter={() => setHover(i)}>
                  {/* A full-height hit target, larger than the mark. */}
                  <rect x={x} y={0} width={bar} height={height} fill="transparent" />
                  {h > 0 && (
                    <path
                      d={`M${x},${height} V${height - h + 4} q0,-4 4,-4 h${bar - 8} q4,0 4,4 V${height} Z`}
                      className={cn(
                        "fill-primary transition-opacity",
                        hover !== null && hover !== i && "opacity-40",
                      )}
                    />
                  )}
                </g>
              );
            })}
            {daily.length > 0 && (
              <>
                <text x={0} y={height + 15} className="fill-muted-foreground text-[10px]">
                  {label(daily[0]?.day ?? "")}
                </text>
                <text
                  x={width}
                  y={height + 15}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {label(daily.at(-1)?.day ?? "")}
                </text>
              </>
            )}
          </svg>
          {hovered && hover !== null && (
            <div
              className="bg-popover text-popover-foreground pointer-events-none absolute top-0 rounded-md border px-2 py-1 text-xs shadow-sm"
              style={{ left: `${Math.min(85, ((hover + 0.5) / daily.length) * 100)}%` }}
            >
              <div className="text-muted-foreground">{label(hovered.day)}</div>
              <div className="font-medium tabular-nums">
                {fmt.format(hovered.requests)} requests
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function UsageView({
  orgSlug,
  initial,
  canManageBilling,
}: {
  orgSlug: string;
  initial: Usage;
  canManageBilling: boolean;
}) {
  const trpc = useTRPC();
  const { data } = useQuery({
    ...trpc.usage.get.queryOptions({ orgSlug }),
    initialData: initial,
    refetchInterval: 60_000,
  });
  const period = `${new Date(`${data.period_start}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })} – ${new Date(`${data.period_end}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}`;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">{data.planName} plan</span>
          <span className="text-muted-foreground"> · {period} (UTC)</span>
        </p>
        {canManageBilling && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${orgSlug}/settings/billing`}>Change plan</Link>
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Meter label="Requests" used={data.requests.used} limit={data.requests.limit} />
        <Meter label="Endpoints" used={data.endpoints.used} limit={data.endpoints.limit} />
        <Meter label="Members" used={data.members.used} limit={data.members.limit} />
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          ["Bytes captured", formatBytes(data.bytes)],
          ["Deliveries", fmt.format(data.deliveries)],
          ["Tunnel minutes", fmt.format(data.tunnel_minutes)],
        ].map(([k, v]) => (
          <div key={k} className="bg-card/30 rounded-xl border p-5">
            <dt className="text-muted-foreground text-xs">{k}</dt>
            <dd className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <DailyChart daily={data.daily} />
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">Plan limits</h2>
        <dl className="bg-card/30 grid overflow-hidden rounded-xl border text-sm sm:grid-cols-2">
          {[
            [
              "Retention",
              data.limits.retentionHours < 48
                ? `${data.limits.retentionHours} hours`
                : `${Math.round(data.limits.retentionHours / 24)} days`,
            ],
            ["Largest body", formatBytes(data.limits.maxBodyBytes)],
            ["Concurrent CLI tunnels", String(data.limits.concurrentTunnels ?? "unlimited")],
            [
              "Destinations per endpoint",
              String(data.limits.destinationsPerEndpoint ?? "unlimited"),
            ],
          ].map(([k, v]) => (
            <div
              key={k}
              className="-mb-px flex items-center justify-between gap-3 border-b px-4 py-3 sm:odd:border-r"
            >
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono text-xs">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-xs">
          Daily totals are rolled up hourly; today's requests and the request limit are counted
          live.
        </p>
      </section>
    </div>
  );
}
