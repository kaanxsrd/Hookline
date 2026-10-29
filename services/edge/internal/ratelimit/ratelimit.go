// Package ratelimit implements token buckets in Redis, shared by every edge
// instance. One script call checks both the endpoint and the source IP bucket.
package ratelimit

import (
	"context"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Rule is a token bucket: Rate tokens per second, up to Burst. A Rate of zero
// or less disables the bucket.
type Rule struct {
	Rate  int64
	Burst int64
}

// Scope says which bucket rejected a request.
type Scope string

// Scopes.
const (
	ScopeEndpoint Scope = "endpoint"
	ScopeIP       Scope = "ip"
)

// Decision is the outcome of Allow.
type Decision struct {
	Allowed    bool
	RetryAfter time.Duration
	Scope      Scope
}

// Both buckets are read first; tokens are only taken when both allow, so a
// request rejected by one bucket does not drain the other. Time comes from
// the Redis server so edge instances with skewed clocks agree.
var script = redis.NewScript(`
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local function refill(key, rate, burst)
  if rate <= 0 then return nil end
  local v = redis.call('HMGET', key, 'tokens', 'ts')
  local tokens = tonumber(v[1]) or burst
  local ts = tonumber(v[2]) or now
  return math.min(burst, tokens + math.max(0, now - ts) * rate / 1000)
end

local function take(key, tokens, rate, burst)
  redis.call('HSET', key, 'tokens', tostring(tokens - 1), 'ts', tostring(now))
  redis.call('PEXPIRE', key, math.ceil(burst * 1000 / rate) + 1000)
end

local r1, b1 = tonumber(ARGV[1]), tonumber(ARGV[2])
local r2, b2 = tonumber(ARGV[3]), tonumber(ARGV[4])
local t1 = refill(KEYS[1], r1, b1)
local t2 = refill(KEYS[2], r2, b2)
if t1 ~= nil and t1 < 1 then return {0, math.ceil((1 - t1) * 1000 / r1), 1} end
if t2 ~= nil and t2 < 1 then return {0, math.ceil((1 - t2) * 1000 / r2), 2} end
if t1 ~= nil then take(KEYS[1], t1, r1, b1) end
if t2 ~= nil then take(KEYS[2], t2, r2, b2) end
return {1, 0, 0}
`)

// Limiter applies per-endpoint and per-IP buckets.
type Limiter struct {
	rdb   *redis.Client
	perIP Rule
}

// New returns a Limiter. perIP applies to every source address.
func New(rdb *redis.Client, perIP Rule) *Limiter {
	return &Limiter{rdb: rdb, perIP: perIP}
}

// Allow takes one token from the endpoint's bucket and the IP's bucket. When
// Redis fails it returns Allowed together with the error: callers fail open.
func (l *Limiter) Allow(ctx context.Context, endpointID uuid.UUID, endpoint Rule, ip netip.Addr) (Decision, error) {
	ipRule := l.perIP
	if !ip.IsValid() {
		ipRule = Rule{}
	}
	res, err := script.Run(ctx, l.rdb,
		[]string{"hl:rl:ep:" + endpointID.String(), "hl:rl:ip:" + ip.String()},
		endpoint.Rate, endpoint.Burst, ipRule.Rate, ipRule.Burst,
	).Int64Slice()
	if err != nil {
		return Decision{Allowed: true}, fmt.Errorf("rate limit: %w", err)
	}
	if len(res) != 3 {
		return Decision{Allowed: true}, fmt.Errorf("rate limit: unexpected reply %v", res)
	}
	if res[0] == 1 {
		return Decision{Allowed: true}, nil
	}
	scope := ScopeEndpoint
	if res[2] == 2 {
		scope = ScopeIP
	}
	return Decision{Allowed: false, RetryAfter: time.Duration(res[1]) * time.Millisecond, Scope: scope}, nil
}
