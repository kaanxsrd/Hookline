package logging

import (
	"sync"
	"time"
)

// Throttle limits how often a repeated condition is logged, e.g. "Redis is
// unreachable" while serving a thousand requests per second.
type Throttle struct {
	every time.Duration

	mu         sync.Mutex
	last       time.Time
	suppressed int
}

// NewThrottle allows one event per interval.
func NewThrottle(every time.Duration) *Throttle {
	return &Throttle{every: every}
}

// Allow reports whether an event at now should be logged, and how many
// events were suppressed since the last allowed one.
func (t *Throttle) Allow(now time.Time) (ok bool, suppressed int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.last.IsZero() && now.Sub(t.last) < t.every {
		t.suppressed++
		return false, 0
	}
	t.last = now
	suppressed, t.suppressed = t.suppressed, 0
	return true, suppressed
}
