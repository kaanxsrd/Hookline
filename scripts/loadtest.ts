/**
 * bun run loadtest -- --url <intake URL> [options]
 *
 * Sends webhooks to an endpoint as fast as allowed (or at --rate) and reports
 * throughput, latency percentiles and outcomes. Exits 1 when the share of
 * non-2xx answers and errors is above --max-failure-rate.
 *
 *   --url URL              intake URL, e.g. http://localhost:8080/h/AbCdEf123456
 *   --duration 30s         how long to run (ms, s or m)
 *   --concurrency 32       requests in flight at once
 *   --rate N               target requests per second overall (default: unlimited)
 *   --body-size 512        bytes of JSON per request
 *   --timeout 10s          per-request timeout
 *   --spread-ips           send a random X-Forwarded-For per request, so the
 *                          edge's per-IP limit does not cap one machine. Only
 *                          works when talking to the edge directly from a
 *                          trusted (loopback or private) address.
 *   --max-failure-rate 0.01
 *
 * Use an endpoint whose plan allows the load (PLAN_OVERRIDE=unlimited or a
 * Team plan): plan rate limits and monthly quotas apply as for any sender.
 */
import { parseArgs } from "node:util";
import { type Outcome, parseDuration, randomPrivateIp, summarize } from "./lib/loadstats";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    duration: { type: "string", default: "30s" },
    concurrency: { type: "string", default: "32" },
    rate: { type: "string" },
    "body-size": { type: "string", default: "512" },
    timeout: { type: "string", default: "10s" },
    "spread-ips": { type: "boolean", default: false },
    "max-failure-rate": { type: "string", default: "0.01" },
  },
});

function fail(message: string): never {
  console.error(message);
  console.error("usage: bun run loadtest -- --url http://localhost:8080/h/<slug> [--duration 30s]");
  process.exit(2);
}

if (!values.url) fail("--url is required.");
const url = new URL(values.url);
const durationMs = parseDuration(values.duration);
const timeoutMs = parseDuration(values.timeout);
const concurrency = Number(values.concurrency);
const rate = values.rate ? Number(values.rate) : undefined;
const bodySize = Number(values["body-size"]);
const maxFailureRate = Number(values["max-failure-rate"]);
if (!Number.isInteger(concurrency) || concurrency < 1)
  fail("--concurrency must be a positive integer.");
if (rate !== undefined && !(rate > 0)) fail("--rate must be positive.");
if (!Number.isInteger(bodySize) || bodySize < 2) fail("--body-size must be at least 2.");

const padding = "x".repeat(Math.max(0, bodySize - 40));
let sequence = 0;
const body = () => JSON.stringify({ type: "loadtest", n: sequence++, pad: padding });

const outcomes: Outcome[] = [];
const started = performance.now();
const deadline = started + durationMs;
// With --rate, each worker owns an equal share and paces itself.
const interval = rate ? (1000 * concurrency) / rate : 0;

async function worker(): Promise<void> {
  let next = performance.now();
  while (performance.now() < deadline) {
    if (interval) {
      const wait = next - performance.now();
      if (wait > 0) await Bun.sleep(wait);
      next += interval;
      if (performance.now() >= deadline) return;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (values["spread-ips"]) headers["X-Forwarded-For"] = randomPrivateIp();
    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: body(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.arrayBuffer();
      outcomes.push({ status: res.status, ms: performance.now() - t0 });
    } catch (error) {
      const name = error instanceof Error ? error.name : "error";
      outcomes.push({
        error: name === "TimeoutError" ? "timeout" : name,
        ms: performance.now() - t0,
      });
    }
  }
}

console.log(
  `Load testing ${url.origin}${url.pathname} for ${durationMs / 1000}s ` +
    `with ${concurrency} workers${rate ? ` at ${rate} req/s` : ""}…`,
);
const progress = setInterval(() => {
  const elapsed = (performance.now() - started) / 1000;
  process.stdout.write(`\r  ${outcomes.length} requests in ${elapsed.toFixed(0)}s`);
}, 1000);
await Promise.all(Array.from({ length: concurrency }, worker));
clearInterval(progress);

const s = summarize(outcomes, (performance.now() - started) / 1000);
const fmt = (ms: number) => `${ms.toFixed(1)} ms`;
console.log(`\r
Requests     ${s.total} in ${s.seconds.toFixed(1)}s (${s.rps.toFixed(1)} req/s)
Succeeded    ${s.ok} (${((1 - s.failureRate) * 100).toFixed(2)} %)
Statuses     ${
  Object.entries(s.statuses)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ") || "none"
}
Errors       ${
  Object.entries(s.errors)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ") || "none"
}
Latency      p50 ${fmt(s.latency.p50)}  p90 ${fmt(s.latency.p90)}  p99 ${fmt(s.latency.p99)}  max ${fmt(s.latency.max)}`);

if (s.statuses["429"]) {
  console.log(
    "\n429s mean a rate limit or quota answered: check the endpoint's plan, or use --spread-ips against the edge directly.",
  );
}
if (s.failureRate > maxFailureRate) {
  console.error(
    `\nFailure rate ${(s.failureRate * 100).toFixed(2)} % is above ${(maxFailureRate * 100).toFixed(2)} %.`,
  );
  process.exit(1);
}
