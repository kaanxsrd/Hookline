/** Latency and outcome bookkeeping for scripts/loadtest.ts. */

export type Outcome = { status: number; ms: number } | { error: string; ms: number };

export type Summary = {
  total: number;
  seconds: number;
  rps: number;
  ok: number;
  statuses: Record<string, number>;
  errors: Record<string, number>;
  failureRate: number;
  latency: { p50: number; p90: number; p99: number; max: number; mean: number };
};

/** The value at quantile q (0..1) of an ascending list, nearest-rank. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

/** Summarizes outcomes; anything but a 2xx answer counts as a failure. */
export function summarize(outcomes: readonly Outcome[], seconds: number): Summary {
  const statuses: Record<string, number> = {};
  const errors: Record<string, number> = {};
  let ok = 0;
  for (const o of outcomes) {
    if ("status" in o) {
      statuses[o.status] = (statuses[o.status] ?? 0) + 1;
      if (o.status >= 200 && o.status < 300) ok++;
    } else {
      errors[o.error] = (errors[o.error] ?? 0) + 1;
    }
  }
  const ms = outcomes.map((o) => o.ms).sort((a, b) => a - b);
  const total = outcomes.length;
  return {
    total,
    seconds,
    rps: seconds > 0 ? total / seconds : 0,
    ok,
    statuses,
    errors,
    failureRate: total > 0 ? (total - ok) / total : 0,
    latency: {
      p50: quantile(ms, 0.5),
      p90: quantile(ms, 0.9),
      p99: quantile(ms, 0.99),
      max: ms.at(-1) ?? 0,
      mean: total > 0 ? ms.reduce((a, b) => a + b, 0) / total : 0,
    },
  };
}

/** "30s", "2m", "1500ms" or a bare number of seconds, in milliseconds. */
export function parseDuration(value: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value.trim());
  if (!m) throw new Error(`invalid duration: ${value}`);
  const n = Number(m[1]);
  return m[2] === "ms" ? n : m[2] === "m" ? n * 60_000 : n * 1000;
}

/** A random address in 10.0.0.0/8 (distinct per-IP buckets on the edge). */
export function randomPrivateIp(random = Math.random): string {
  const octet = () => Math.floor(random() * 256);
  return `10.${octet()}.${octet()}.${octet()}`;
}
