"use client";

import { CircleAlert, CircleCheck, Clock, Repeat, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DeliveryDetail } from "./types";

const statusStyle = {
  succeeded: {
    icon: CircleCheck,
    className: "text-emerald-600 dark:text-emerald-400",
    label: "Delivered",
  },
  failed: { icon: CircleAlert, className: "text-destructive", label: "Failed" },
  pending: { icon: Clock, className: "text-amber-600 dark:text-amber-400", label: "Retrying" },
  cancelled: { icon: CircleAlert, className: "text-muted-foreground", label: "Cancelled" },
} as const;

/** Every delivery of a request and each attempt, oldest first. */
export function DeliveriesTimeline({
  deliveries,
  onRetry,
}: {
  deliveries: DeliveryDetail[];
  onRetry?: ((deliveryId: string) => Promise<void>) | undefined;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);
  if (deliveries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Not forwarded anywhere. Add a destination to forward requests automatically.
      </p>
    );
  }
  return (
    <ol className="grid gap-6">
      {deliveries.map((d) => {
        const style = statusStyle[d.status];
        const Icon = style.icon;
        return (
          <li key={d.id} className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Icon className={cn("size-4", style.className)} aria-hidden />
              <span className="font-medium">{d.destination_name}</span>
              <span className={cn("text-xs", style.className)}>{style.label}</span>
              {d.trigger !== "auto" && (
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <Repeat className="size-3" aria-hidden /> {d.trigger}
                </span>
              )}
              <span className="text-muted-foreground ml-auto truncate font-mono text-xs">
                {d.destination_url}
              </span>
              {onRetry && d.status !== "pending" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={retrying !== null}
                  onClick={async () => {
                    setRetrying(d.id);
                    try {
                      await onRetry(d.id);
                    } finally {
                      setRetrying(null);
                    }
                  }}
                >
                  <RotateCcw aria-hidden /> Retry
                </Button>
              )}
            </div>
            <ol className="border-border ml-2 grid gap-3 border-l pl-4">
              {d.attempts.map((a) => (
                <li key={a.attempt_no} className="grid gap-1 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">Attempt {a.attempt_no}</span>
                    <span
                      className={cn(
                        "font-mono",
                        a.status_code && a.status_code < 300
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-destructive",
                      )}
                    >
                      {a.status_code ?? "no response"}
                    </span>
                    {a.duration_ms !== null && (
                      <span className="text-muted-foreground">{Math.round(a.duration_ms)} ms</span>
                    )}
                    <time className="text-muted-foreground" dateTime={a.started_at}>
                      {new Date(a.started_at).toLocaleString()}
                    </time>
                  </div>
                  {a.error && <p className="text-destructive">{a.error}</p>}
                  {a.response_preview && (
                    <pre className="bg-muted/50 max-h-32 overflow-auto rounded p-2 font-mono break-all whitespace-pre-wrap">
                      {a.response_preview}
                    </pre>
                  )}
                </li>
              ))}
              {d.status === "pending" && d.next_attempt_at && (
                <li className="text-muted-foreground text-xs">
                  Next attempt {new Date(d.next_attempt_at).toLocaleString()}
                </li>
              )}
            </ol>
          </li>
        );
      })}
    </ol>
  );
}
