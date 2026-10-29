import { CircleAlert, CircleCheck, CircleHelp, CircleX } from "lucide-react";
import type { Metadata } from "next";
import { type ComponentState, currentStatus, overallState } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Status",
  description: "Whether webhook intake, forwarding and the dashboard are working right now.",
};

export const dynamic = "force-dynamic";

const STATE: Record<
  ComponentState,
  { label: string; icon: typeof CircleCheck; className: string; headline: string }
> = {
  operational: {
    label: "Operational",
    icon: CircleCheck,
    className: "text-emerald-600 dark:text-emerald-400",
    headline: "All systems operational",
  },
  degraded: {
    label: "Degraded",
    icon: CircleAlert,
    className: "text-amber-600 dark:text-amber-400",
    headline: "Some systems are degraded",
  },
  down: {
    label: "Down",
    icon: CircleX,
    className: "text-red-600 dark:text-red-400",
    headline: "Some systems are down",
  },
  unknown: {
    label: "Not monitored",
    icon: CircleHelp,
    className: "text-muted-foreground",
    headline: "Status unknown",
  },
};

export default async function StatusPage() {
  const report = await currentStatus();
  const overall = STATE[overallState(report.components)];
  const OverallIcon = overall.icon;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Status</h1>
      <div
        className="bg-card mt-8 flex items-center gap-3 rounded-xl border p-5"
        role="status"
        data-testid="overall-status"
      >
        <OverallIcon className={cn("size-6", overall.className)} aria-hidden />
        <p className="text-lg font-medium">{overall.headline}</p>
      </div>

      <ul className="mt-6 divide-y rounded-xl border">
        {report.components.map((c) => {
          const s = STATE[c.state];
          const Icon = s.icon;
          return (
            <li
              key={c.id}
              className="flex items-center justify-between gap-4 p-4"
              data-testid={`status-${c.id}`}
            >
              <div className="min-w-0">
                <p className="font-medium">{c.name}</p>
                <p className="text-muted-foreground text-sm">{c.description}</p>
              </div>
              <span className={cn("flex shrink-0 items-center gap-1.5 text-sm", s.className)}>
                <Icon className="size-4" aria-hidden />
                {s.label}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground mt-4 text-xs">
        Checked{" "}
        <time dateTime={report.checkedAt.toISOString()}>
          {report.checkedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
        </time>
        . Refreshed at most every 30 seconds.
      </p>
    </div>
  );
}
