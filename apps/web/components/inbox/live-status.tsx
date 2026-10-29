import type { LiveStatus } from "./use-request-stream";

const labels: Record<LiveStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

export function LiveStatusBadge({ status }: { status: LiveStatus }) {
  return (
    <span
      data-testid="live-status"
      data-status={status}
      role="status"
      className="text-muted-foreground inline-flex items-center gap-2 text-sm"
    >
      <span className="relative flex size-2">
        {status === "live" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${
            status === "live" ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
      </span>
      {labels[status]}
    </span>
  );
}
