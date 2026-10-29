import { Badge } from "@/components/ui/badge";

const labels = {
  active: "Active",
  paused: "Paused",
  disabled_by_admin: "Disabled",
} as const;

export function EndpointStatusBadge({ status }: { status: keyof typeof labels }) {
  return (
    <Badge
      variant={status === "active" ? "secondary" : "outline"}
      className={
        status === "active"
          ? "text-emerald-700 dark:text-emerald-300"
          : status === "paused"
            ? "text-amber-700 dark:text-amber-300"
            : "text-destructive"
      }
    >
      {labels[status]}
    </Badge>
  );
}
