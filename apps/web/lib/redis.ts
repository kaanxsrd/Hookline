import "server-only";
import Redis from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as typeof globalThis & { __hooklineRedis?: Redis };

/**
 * Shared Redis client. Redis is an accelerator, never the system of record:
 * callers treat failures as non-fatal (the edge's endpoint cache expires on
 * its own within 60 seconds).
 */
export function getRedis(): Redis {
  globalForRedis.__hooklineRedis ??= new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    // Commands wait briefly for a (re)connection, then fail instead of hanging.
    commandTimeout: 1_000,
  });
  // Errors surface on the commands; an unhandled "error" event would crash the process.
  globalForRedis.__hooklineRedis.on("error", () => {});
  return globalForRedis.__hooklineRedis;
}

/** Drops the edge's cached copy of an endpoint so settings apply immediately. */
export async function invalidateEndpointCache(slug: string): Promise<void> {
  try {
    await getRedis().del(`hl:ep:${slug}`);
  } catch (error) {
    console.warn("could not invalidate endpoint cache; it expires within 60s", { slug, error });
  }
}

/** Publishes an event to the endpoint's live stream (see services/edge/internal/live). */
export async function publishEndpointEvent(
  endpointId: string,
  type: "endpoint" | "delivery",
  payload: unknown,
): Promise<void> {
  try {
    await getRedis().publish(`ep:${endpointId}`, JSON.stringify({ type, payload }));
  } catch (error) {
    console.warn("could not publish live event", { endpointId, type, error });
  }
}

/** CLI tunnels connected to an endpoint (sessions refresh their entry while alive). */
export async function tunnelCount(endpointId: string): Promise<number> {
  try {
    return await getRedis().zcount(`tunnel:ep-sessions:${endpointId}`, Date.now(), "+inf");
  } catch {
    return 0;
  }
}
