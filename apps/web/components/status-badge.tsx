import { StatusPill } from "@/components/status-pill";

const states = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  disabled_by_admin: { label: "Disabled", tone: "danger" },
} as const;

export function EndpointStatusBadge({ status }: { status: keyof typeof states }) {
  const s = states[status];
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}
