package deliver_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/kaanxsrd/hookline/services/worker/internal/deliver"
)

func TestBackoffGrowsAndCaps(t *testing.T) {
	top := func() float64 { return 0.999999 }
	assert.InDelta(t, 10*time.Second, deliver.Backoff(1, top), float64(50*time.Millisecond))
	assert.InDelta(t, 20*time.Second, deliver.Backoff(2, top), float64(50*time.Millisecond))
	assert.InDelta(t, 80*time.Second, deliver.Backoff(4, top), float64(50*time.Millisecond))
	assert.InDelta(t, 6*time.Hour, deliver.Backoff(30, top), float64(50*time.Millisecond), "capped")
	assert.Equal(t, time.Second, deliver.Backoff(3, func() float64 { return 0 }), "never below a second")

	half := deliver.Backoff(5, func() float64 { return 0.5 })
	assert.Equal(t, 80*time.Second, half, "full jitter: uniform in [0, ceiling]")
}

func TestRetryAfter(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	d, ok := deliver.RetryAfter("30", now)
	assert.True(t, ok)
	assert.Equal(t, 30*time.Second, d)

	d, ok = deliver.RetryAfter("Thu, 01 Jan 2026 12:02:00 GMT", now)
	assert.True(t, ok)
	assert.Equal(t, 2*time.Minute, d)

	d, ok = deliver.RetryAfter("999999", now)
	assert.True(t, ok)
	assert.Equal(t, deliver.BackoffCap, d)

	for _, bad := range []string{"", "soon", "-5"} {
		_, ok := deliver.RetryAfter(bad, now)
		assert.False(t, ok, bad)
	}
}

func TestRetryable(t *testing.T) {
	for code, want := range map[int]bool{200: false, 400: false, 401: false, 404: false, 408: true, 409: false, 422: false, 429: true, 500: true, 502: true, 503: true} {
		assert.Equal(t, want, deliver.Retryable(code), code)
	}
}
