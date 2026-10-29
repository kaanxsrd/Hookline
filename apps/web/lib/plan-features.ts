import { type Limits, limitsFor, type PaidPlan } from "@hookline/shared";

/** "5,000 requests a month", or "Unlimited requests a month" for a null limit. */
export function formatLimit(value: number | null, unit: string): string {
  return value === null ? `Unlimited ${unit}` : `${value.toLocaleString("en-US")} ${unit}`;
}

/** "24 hours", "14 days". */
export function formatRetention(hours: number): string {
  return hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;
}

/** "256 KiB", "5 MiB". */
export function formatBytes(bytes: number): string {
  return bytes >= 1 << 20 ? `${bytes / (1 << 20)} MiB` : `${bytes / 1024} KiB`;
}

/** The headline features of a plan, as shown on pricing and billing pages. */
export function planFeatures(plan: PaidPlan): string[] {
  const l = limitsFor(plan);
  return [
    formatLimit(l.requests_per_month, "requests a month"),
    formatLimit(l.endpoints, "endpoints"),
    `${formatRetention(l.retention_hours)} of history`,
    formatLimit(l.destinations_per_endpoint, "destinations per endpoint"),
    formatLimit(l.concurrent_tunnels, "CLI tunnels at once"),
    formatLimit(l.members, "members"),
  ];
}

/** Every limit of a plan as label/value rows, for comparison tables. */
export function planLimitRows(l: Limits): [label: string, value: string][] {
  const n = (v: number | null) => (v === null ? "Unlimited" : v.toLocaleString("en-US"));
  return [
    ["Requests per month", n(l.requests_per_month)],
    ["Endpoints", n(l.endpoints)],
    ["History", formatRetention(l.retention_hours)],
    ["Largest request body", formatBytes(l.max_body_bytes)],
    ["Destinations per endpoint", n(l.destinations_per_endpoint)],
    ["CLI tunnels at once", n(l.concurrent_tunnels)],
    ["Members", n(l.members)],
    [
      "Audit log",
      l.audit_log_days === 0
        ? "—"
        : l.audit_log_days === null
          ? "Unlimited"
          : `${l.audit_log_days} days`,
    ],
    [
      "Intake rate",
      l.intake_rate_per_second === null
        ? "Unlimited"
        : `${l.intake_rate_per_second}/s, bursts of ${l.intake_burst}`,
    ],
  ];
}
