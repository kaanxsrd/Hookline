// Package counters batches endpoint.request_count and last_request_at
// updates. Updating the endpoint row inside every intake transaction would
// serialize all requests to one endpoint on a row lock.
package counters

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
)

type pending struct {
	n    int64
	last time.Time
}

// Counters accumulates increments in memory and flushes them periodically.
// A crash loses at most one interval of counts; the request rows themselves
// are already committed.
type Counters struct {
	q        *dbq.Queries
	logger   *slog.Logger
	interval time.Duration

	mu      sync.Mutex
	pending map[uuid.UUID]pending
}

// New returns Counters flushing every interval.
func New(q *dbq.Queries, logger *slog.Logger, interval time.Duration) *Counters {
	return &Counters{q: q, logger: logger, interval: interval, pending: map[uuid.UUID]pending{}}
}

// Add records one request to endpoint at receivedAt.
func (c *Counters) Add(endpoint uuid.UUID, receivedAt time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	p := c.pending[endpoint]
	p.n++
	if receivedAt.After(p.last) {
		p.last = receivedAt
	}
	c.pending[endpoint] = p
}

// Run flushes every interval until ctx ends, then flushes once more.
func (c *Counters) Run(ctx context.Context) {
	t := time.NewTicker(c.interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			c.Flush(ctx)
		case <-ctx.Done():
			final, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			c.Flush(final)
			cancel()
			return
		}
	}
}

// Flush writes accumulated counts. Failed writes are put back for the next flush.
func (c *Counters) Flush(ctx context.Context) {
	c.mu.Lock()
	batch := c.pending
	c.pending = map[uuid.UUID]pending{}
	c.mu.Unlock()

	for id, p := range batch {
		err := c.q.AddEndpointRequests(ctx, dbq.AddEndpointRequestsParams{ID: id, N: p.n, LastRequestAt: p.last})
		if err == nil {
			continue
		}
		c.logger.WarnContext(ctx, "flush endpoint counters", "endpoint_id", id, "error", err)
		c.mu.Lock()
		q := c.pending[id]
		q.n += p.n
		if p.last.After(q.last) {
			q.last = p.last
		}
		c.pending[id] = q
		c.mu.Unlock()
	}
}
