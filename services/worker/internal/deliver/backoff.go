package deliver

import (
	"math"
	"net/http"
	"strconv"
	"time"
)

// Retry timing: exponential backoff with full jitter, base 10 s, capped at 6 h.
const (
	BackoffBase = 10 * time.Second
	BackoffCap  = 6 * time.Hour
	minDelay    = time.Second
)

// Backoff returns the delay before retrying after `attempt` failures
// (1-based): a uniformly random duration in [0, min(cap, base·2^(attempt-1))],
// never below one second. rnd returns values in [0, 1).
func Backoff(attempt int, rnd func() float64) time.Duration {
	ceiling := float64(BackoffBase) * math.Pow(2, float64(max(attempt, 1)-1))
	ceiling = math.Min(ceiling, float64(BackoffCap))
	return max(minDelay, time.Duration(rnd()*ceiling))
}

// RetryAfter parses a Retry-After header (seconds or an HTTP date) relative
// to now, capped at BackoffCap. ok is false when the header is absent or invalid.
func RetryAfter(value string, now time.Time) (time.Duration, bool) {
	if value == "" {
		return 0, false
	}
	var d time.Duration
	if secs, err := strconv.Atoi(value); err == nil {
		if secs < 0 {
			return 0, false
		}
		d = time.Duration(secs) * time.Second
	} else if at, err := http.ParseTime(value); err == nil {
		d = at.Sub(now)
	} else {
		return 0, false
	}
	return min(max(d, minDelay), BackoffCap), true
}

// Retryable reports whether a response status code is worth retrying:
// request timeouts, rate limiting and server errors.
func Retryable(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
}
