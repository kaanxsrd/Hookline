import { CircleAlert, CircleCheck, CircleHelp, CircleX } from "lucide-react";
import type { Metadata } from "next";
import { PageHero } from "@/components/marketing/page-hero";
import { type ComponentState, currentStatus, overallState } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Status",
  description: "Whether webhook intake, forwarding and the dashboard are working right now.",
};

export const dynamic = "force-dynamic";

const STATE: Record<
  ComponentState,
  {
    label: string;
    icon: typeof CircleCheck;
    className: string;
    headline: string;
    dot: string;
    bar: string;
  }
> = {
  operational: {
    label: "Operational",
    icon: CircleCheck,
    className: "text-emerald-600 dark:text-emerald-400",
    headline: "All systems operational",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
  },
  degraded: {
    label: "Degraded",
    icon: CircleAlert,
    className: "text-amber-600 dark:text-amber-400",
    headline: "Some systems are degraded",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
  },
  down: {
    label: "Down",
    icon: CircleX,
    className: "text-red-600 dark:text-red-400",
    headline: "Some systems are down",
    dot: "bg-red-500",
    bar: "bg-red-500",
  },
  unknown: {
    label: "Not monitored",
    icon: CircleHelp,
    className: "text-muted-foreground",
    headline: "Status unknown",
    dot: "bg-muted-foreground",
    bar: "bg-muted-foreground",
  },
};

export default async function StatusPage() {
  const report = await currentStatus();
  const overall = STATE[overallState(report.components)];
  const OverallIcon = overall.icon;

  return (
    <>
      <PageHero eyebrow="Status" title="Status">
        Whether webhook intake, forwarding and the dashboard are working right now.
      </PageHero>
      <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <div
          className="bg-card/80 relative flex items-center gap-4 overflow-hidden rounded-2xl border p-6 backdrop-blur"
          role="status"
          data-testid="overall-status"
        >
          <div aria-hidden className={cn("absolute inset-y-0 left-0 w-1", overall.bar)} />
          <span className="relative flex size-3 shrink-0">
            <span
              className={cn(
                "animate-pulse-ring absolute inline-flex size-full rounded-full",
                overall.dot,
              )}
            />
            <span className={cn("relative inline-flex size-3 rounded-full", overall.dot)} />
          </span>
          <OverallIcon className={cn("size-6 shrink-0", overall.className)} aria-hidden />
          <p className="text-lg font-medium">{overall.headline}</p>
        </div>

        <ul className="bg-card/60 mt-6 divide-y overflow-hidden rounded-2xl border backdrop-blur">
          {report.components.map((c) => {
            const s = STATE[c.state];
            const Icon = s.icon;
            return (
              <li
                key={c.id}
                className="hover:bg-accent/40 flex items-center justify-between gap-4 p-5 transition-colors"
                data-testid={`status-${c.id}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("size-2 shrink-0 rounded-full", s.dot)} aria-hidden />
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-muted-foreground text-sm">{c.description}</p>
                  </div>
                </div>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 font-mono text-xs",
                    s.className,
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground mt-4 font-mono text-xs">
          Checked{" "}
          <time dateTime={report.checkedAt.toISOString()}>
            {report.checkedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
          </time>
          {" · "}refreshed at most every 30 seconds
        </p>
      </div>
    </>
  );
}
