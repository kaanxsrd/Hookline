// A fixed locale keeps server-rendered and client-rendered text identical.

export function formatDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString("en-US", { dateStyle: "medium" }) : "—";
}

export function formatDateTime(d: Date | null | undefined): string {
  return d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
