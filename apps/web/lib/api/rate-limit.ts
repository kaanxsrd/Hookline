import "server-only";
import { createRateLimiter, redisStore } from "@vantedev/groundwork/rate-limit";
import { env } from "../env";
import { getRedis } from "../redis";

/** Requests per key: a bucket of BURST refilled at RATE per second. */
export const API_RATE_PER_SECOND = 10;
export const API_BURST = 120;

/**
 * The per-key token bucket, counted in Redis by groundwork with one script per request. Key ids
 * are stored as HMACs keyed from BETTER_AUTH_SECRET, read on the first check, so `next build`
 * needs no secret. If Redis is unavailable, each instance keeps counting in memory until it's back.
 */
const apiRule = createRateLimiter({
  store: redisStore({
    client: {
      eval: (script, keys, args) => getRedis().eval(script, keys.length, ...keys, ...args),
    },
  }),
  secret: () => env().BETTER_AUTH_SECRET,
}).rule({
  name: "api:key",
  algorithm: "token-bucket",
  rate: API_RATE_PER_SECOND,
  per: "1s",
  burst: API_BURST,
});

export type RateDecision = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the bucket is full again. */
  resetSeconds: number;
  /** Seconds until the next token, when denied. */
  retryAfterSeconds: number;
};

/** Takes one token for the key. */
export async function takeToken(keyId: string): Promise<RateDecision> {
  const result = await apiRule.check(keyId);
  return {
    allowed: result.allowed,
    remaining: result.remaining,
    resetSeconds: Math.ceil((API_BURST - result.remaining) / API_RATE_PER_SECOND),
    retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
  };
}

export function rateLimitHeaders(d: RateDecision): Record<string, string> {
  return {
    "RateLimit-Limit": String(API_BURST),
    "RateLimit-Remaining": String(Math.max(0, d.remaining)),
    "RateLimit-Reset": String(d.resetSeconds),
  };
}
