import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../env", () => ({
  env: () => ({ BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789" }),
}));

// Real Redis when TEST_REDIS_URL is set; otherwise only the outage test runs.
const redis = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../redis", () => ({ getRedis: () => redis.client }));

const { API_BURST, rateLimitHeaders, takeToken } = await import("./rate-limit");

const url = process.env.TEST_REDIS_URL;
const real = url ? new Redis(url, { maxRetriesPerRequest: 1 }) : null;

afterAll(async () => {
  await real?.quit();
});

/** Sends more requests than the bucket holds, all at once, faster than it refills. */
async function burst(keyId: string) {
  return Promise.all(Array.from({ length: API_BURST + 10 }, () => takeToken(keyId)));
}

describe("API rate limit", () => {
  // Runs first: after a Redis failure, groundwork skips the store for a few seconds.
  it.skipIf(!real)("counts each key's bucket in Redis, under an HMAC", async () => {
    if (!real) return;
    redis.client = real;
    const keyId = randomUUID();
    const decisions = await burst(keyId);
    const allowed = decisions.filter((d) => d.allowed).length;
    expect(allowed).toBeGreaterThanOrEqual(API_BURST);
    expect(allowed).toBeLessThan(API_BURST + 10);

    const denied = decisions.find((d) => !d.allowed);
    if (!denied) throw new Error("the bucket never emptied");
    expect(denied).toMatchObject({ remaining: 0, resetSeconds: 12 });
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(rateLimitHeaders(denied)).toEqual({
      "RateLimit-Limit": "120",
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": "12",
    });

    const keys = await real.keys("gw:rl:*");
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join()).not.toContain(keyId);
    await real.del(...keys);
  });

  it("keeps limiting in memory while Redis is down", async () => {
    redis.client = { eval: () => Promise.reject(new Error("connect ECONNREFUSED")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const decisions = await burst(randomUUID());
      expect(decisions.filter((d) => d.allowed).length).toBeGreaterThanOrEqual(API_BURST);
      expect(decisions.some((d) => !d.allowed)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
