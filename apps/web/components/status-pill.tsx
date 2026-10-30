import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const tones: Record<Tone, { pill: string; dot: string }> = {
  success: {
    pill: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  warning: {
    pill: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  danger: {
    pill: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
  info: {
    pill: "border-primary/25 bg-primary/10 text-primary",
    dot: "bg-primary",
  },
  neutral: {
    pill: "border-border bg-muted/60 text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

/** A small capsule with a coloured dot: statuses in tables and headers. */
export function StatusPill({
  tone,
  children,
  pulse = false,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  /** Animates the dot, for live or in-progress states. */
  pulse?: boolean;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        t.pill,
        className,
      )}
    >
      <span className="relative flex size-1.5">
        {pulse && (
          <span
            className={cn("animate-pulse-ring absolute inline-flex size-full rounded-full", t.dot)}
          />
        )}
        <span className={cn("relative inline-flex size-1.5 rounded-full", t.dot)} />
      </span>
      {children}
    </span>
  );
}
