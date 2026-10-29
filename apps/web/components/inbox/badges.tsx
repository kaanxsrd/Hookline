import { ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryStatus, SignatureStatus } from "./types";

export function SignatureBadge({
  status,
  compact = false,
}: {
  status: SignatureStatus;
  compact?: boolean;
}) {
  if (status === "unchecked") {
    return compact ? null : <span className="text-muted-foreground text-xs">Unchecked</span>;
  }
  const verified = status === "verified";
  const Icon = verified ? ShieldCheck : ShieldAlert;
  return (
    <span
      title={verified ? "Signature verified" : "Signature invalid"}
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        verified ? "text-emerald-700 dark:text-emerald-300" : "text-destructive",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {compact ? (
        <span className="sr-only">{verified ? "Verified" : "Invalid"}</span>
      ) : verified ? (
        "Verified"
      ) : (
        "Invalid"
      )}
    </span>
  );
}

const dotColors: Record<DeliveryStatus, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-red-500",
  pending: "bg-amber-500",
  cancelled: "bg-zinc-400",
};

export function DeliveryDots({ statuses }: { statuses: DeliveryStatus[] | undefined }) {
  if (!statuses?.length) return null;
  return (
    <span className="flex items-center gap-0.5" title={`Deliveries: ${statuses.join(", ")}`}>
      {statuses.slice(0, 5).map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one dot per delivery, in creation order
        <span key={i} className={cn("size-1.5 rounded-full", dotColors[s])} />
      ))}
      <span className="sr-only">Deliveries: {statuses.join(", ")}</span>
    </span>
  );
}

export function StatusCode({ code }: { code: number }) {
  if (!code) return null;
  return (
    <span
      className={cn(
        "font-mono text-xs",
        code < 300
          ? "text-emerald-700 dark:text-emerald-300"
          : code < 500
            ? "text-amber-700 dark:text-amber-300"
            : "text-destructive",
      )}
    >
      {code}
    </span>
  );
}
