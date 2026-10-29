import "server-only";
import { getRedis } from "../redis";

/** Requests per key: a bucket of BURST refilled at RATE per second. */
export const API_RATE_PER_SECOND = 10;
export const API_BURST = 120;

// Token bucket in Redis (the same scheme as the edge's intake limits).
const SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local rate, burst = tonumber(ARGV[1]), tonumber(ARGV[2])
local v = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(v[1]) or burst
local ts = tonumber(v[2]) or now
tokens = math.min(burst, tokens + math.max(0, now - ts) * rate / 1000)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(burst / rate * 1000) + 1000)
return {allowed, tostring(tokens)}
`;

export type RateDecision = { allowed: boolean; remaining: number; resetSeconds: number };

/** Takes one token for the key. Fails open when Redis is unavailable. */
export async function takeToken(keyId: string): Promise<RateDecision> {
  try {
    const [allowed, tokens] = (await getRedis().eval(
      SCRIPT,
      1,
      `rl:api:${keyId}`,
      API_RATE_PER_SECOND,
      API_BURST,
    )) as [number, string];
    const left = Number(tokens);
    return {
      allowed: allowed === 1,
      remaining: Math.floor(left),
      resetSeconds: Math.ceil((API_BURST - left) / API_RATE_PER_SECOND),
    };
  } catch {
    return { allowed: true, remaining: API_BURST, resetSeconds: 0 };
  }
}

export function rateLimitHeaders(d: RateDecision): Record<string, string> {
  return {
    "RateLimit-Limit": String(API_BURST),
    "RateLimit-Remaining": String(Math.max(0, d.remaining)),
    "RateLimit-Reset": String(d.resetSeconds),
  };
}
