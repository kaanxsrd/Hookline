import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { env } from "./env";
import { getRedis } from "./redis";

export type ComponentState = "operational" | "degraded" | "down" | "unknown";

export type ComponentStatus = {
  id: "web" | "intake" | "database" | "redis" | "worker";
  name: string;
  description: string;
  state: ComponentState;
};

export type StatusReport = { checkedAt: Date; components: ComponentStatus[] };

const TIMEOUT_MS = 2_000;
const CACHE_MS = 30_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS)),
  ]);
}

async function database(): Promise<ComponentState> {
  try {
    await withTimeout(getDb().execute(sql`SELECT 1`));
    return "operational";
  } catch {
    return "down";
  }
}

async function redis(): Promise<ComponentState> {
  try {
    return (await withTimeout(getRedis().ping())) === "PONG" ? "operational" : "down";
  } catch {
    return "down";
  }
}

/** The edge's own readiness: "degraded" while it runs without Redis or object storage. */
async function intake(): Promise<ComponentState> {
  const base = env().EDGE_INTERNAL_URL;
  if (!base) return "unknown";
  try {
    const res = await fetch(new URL("/readyz", base), {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    if (body.status === "ready") return "operational";
    if (body.status === "degraded") return "degraded";
    return "down";
  } catch {
    return "down";
  }
}

/** A worker holds River's leadership lease while it runs; no live lease means none is running. */
async function worker(): Promise<ComponentState> {
  try {
    const rows = await withTimeout(
      getDb().execute<{ alive: boolean }>(
        sql`SELECT expires_at > now() AS alive FROM river_leader WHERE name = 'default'`,
      ),
    );
    return rows[0]?.alive ? "operational" : "down";
  } catch {
    return "unknown";
  }
}

async function check(): Promise<StatusReport> {
  const [intakeState, databaseState, redisState, workerState] = await Promise.all([
    intake(),
    database(),
    redis(),
    worker(),
  ]);
  return {
    checkedAt: new Date(),
    components: [
      {
        id: "web",
        name: "Dashboard and API",
        description: "The web app, sign-in and /api/v1",
        state: "operational",
      },
      {
        id: "intake",
        name: "Webhook intake",
        description: "Capturing requests on /h/…, live streams and CLI tunnels",
        state: intakeState,
      },
      {
        id: "worker",
        name: "Forwarding",
        description: "Deliveries to destinations, retries, replays and retention",
        state: workerState,
      },
      {
        id: "database",
        name: "Database",
        description: "Stored requests, endpoints and accounts",
        state: databaseState,
      },
      {
        id: "redis",
        name: "Live updates",
        description: "Real-time inbox updates and rate limits",
        state: redisState,
      },
    ],
  };
}

let cached: { at: number; report: Promise<StatusReport> } | undefined;

/** Current status, checked at most every 30 seconds however often the page is viewed. */
export function currentStatus(): Promise<StatusReport> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), report: check() };
  }
  return cached.report;
}

/** The worst state among components that are monitored. */
export function overallState(components: ComponentStatus[]): ComponentState {
  const states = components.map((c) => c.state).filter((s) => s !== "unknown");
  if (states.includes("down")) return "down";
  if (states.includes("degraded")) return "degraded";
  return "operational";
}
