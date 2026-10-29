package ratelimit_test

import (
	"net/netip"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/services/edge/internal/ratelimit"
)

func setup(t *testing.T, perIP ratelimit.Rule) (*ratelimit.Limiter, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return ratelimit.New(rdb, perIP), mr
}

func TestEndpointBucket(t *testing.T) {
	l, mr := setup(t, ratelimit.Rule{})
	ep := uuid.New()
	ip := netip.MustParseAddr("203.0.113.1")
	rule := ratelimit.Rule{Rate: 1, Burst: 3}

	for i := range 3 {
		d, err := l.Allow(t.Context(), ep, rule, ip)
		require.NoError(t, err)
		assert.True(t, d.Allowed, "request %d within burst", i)
	}
	d, err := l.Allow(t.Context(), ep, rule, ip)
	require.NoError(t, err)
	assert.False(t, d.Allowed)
	assert.Equal(t, ratelimit.ScopeEndpoint, d.Scope)
	assert.Positive(t, d.RetryAfter)
	assert.LessOrEqual(t, d.RetryAfter, time.Second)

	// Refill: miniredis's TIME follows its fake clock.
	mr.SetTime(time.Now().Add(2 * time.Second))
	d, err = l.Allow(t.Context(), ep, rule, ip)
	require.NoError(t, err)
	assert.True(t, d.Allowed, "tokens refill over time")

	other, err := l.Allow(t.Context(), uuid.New(), rule, ip)
	require.NoError(t, err)
	assert.True(t, other.Allowed, "buckets are per endpoint")
}

func TestIPBucketAndNoDoubleSpend(t *testing.T) {
	l, _ := setup(t, ratelimit.Rule{Rate: 1, Burst: 2})
	ip := netip.MustParseAddr("198.51.100.4")
	unlimited := ratelimit.Rule{}

	for range 2 {
		d, err := l.Allow(t.Context(), uuid.New(), unlimited, ip)
		require.NoError(t, err)
		require.True(t, d.Allowed)
	}
	ep := uuid.New()
	d, err := l.Allow(t.Context(), ep, ratelimit.Rule{Rate: 1, Burst: 1}, ip)
	require.NoError(t, err)
	assert.False(t, d.Allowed)
	assert.Equal(t, ratelimit.ScopeIP, d.Scope)

	// The endpoint bucket was not charged for the rejected request.
	d, err = l.Allow(t.Context(), ep, ratelimit.Rule{Rate: 1, Burst: 1}, netip.MustParseAddr("198.51.100.5"))
	require.NoError(t, err)
	assert.True(t, d.Allowed)
}

func TestRedisDownFailsOpen(t *testing.T) {
	l, mr := setup(t, ratelimit.Rule{Rate: 1, Burst: 1})
	mr.Close()
	d, err := l.Allow(t.Context(), uuid.New(), ratelimit.Rule{Rate: 1, Burst: 1}, netip.MustParseAddr("192.0.2.1"))
	require.Error(t, err)
	assert.True(t, d.Allowed)
}
