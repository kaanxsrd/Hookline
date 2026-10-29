// Package stream serves live endpoint events to dashboards over SSE.
//
// Each edge process holds a single Redis pub/sub connection (the Hub). It
// subscribes to an endpoint's channel when the first local viewer arrives and
// unsubscribes when the last one leaves, then fans every message out in
// memory. A viewer that cannot keep up is disconnected; it reconnects and
// resumes from its Last-Event-ID instead of slowing everyone else down.
package stream

import (
	"context"
	"errors"
	"log/slog"
	"sync"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/kaanxsrd/hookline/services/edge/internal/live"
)

// subscriberBuffer is how many events a viewer may fall behind before it is cut off.
const subscriberBuffer = 256

// Close reasons.
const (
	ReasonShutdown = "shutdown" // the edge is restarting; reconnect elsewhere
	ReasonLagging  = "lagging"  // the viewer fell too far behind
)

// ErrClosed is returned by Subscribe after Shutdown.
var ErrClosed = errors.New("stream hub is shut down")

// Subscriber receives one endpoint's raw event messages.
type Subscriber struct {
	channel string
	events  chan []byte
	done    chan struct{}
	once    sync.Once
	reason  string
}

// Events delivers messages in publication order.
func (s *Subscriber) Events() <-chan []byte { return s.events }

// Done is closed when the hub drops the subscriber; Reason says why.
func (s *Subscriber) Done() <-chan struct{} { return s.done }

// Reason is valid after Done is closed.
func (s *Subscriber) Reason() string { return s.reason }

func (s *Subscriber) close(reason string) {
	s.once.Do(func() {
		s.reason = reason
		close(s.done)
	})
}

// Hub multiplexes one Redis subscription across local viewers.
type Hub struct {
	ps     *redis.PubSub
	logger *slog.Logger

	mu     sync.Mutex
	subs   map[string]map[*Subscriber]struct{}
	closed bool
}

// NewHub returns a Hub on rdb. Call Run to start delivering messages.
func NewHub(rdb *redis.Client, logger *slog.Logger) *Hub {
	return &Hub{
		// No channels yet: they are added as viewers subscribe.
		ps:     rdb.Subscribe(context.Background()),
		logger: logger,
		subs:   map[string]map[*Subscriber]struct{}{},
	}
}

// Run dispatches messages until ctx ends. go-redis reconnects and
// resubscribes on its own when Redis restarts.
func (h *Hub) Run(ctx context.Context) {
	ch := h.ps.Channel(redis.WithChannelSize(1024))
	for {
		select {
		case <-ctx.Done():
			h.Shutdown()
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			h.dispatch(ctx, msg.Channel, []byte(msg.Payload))
		}
	}
}

func (h *Hub) dispatch(ctx context.Context, channel string, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.subs[channel] {
		select {
		case s.events <- payload:
		default:
			s.close(ReasonLagging)
			h.removeLocked(ctx, s)
		}
	}
}

// Subscribe registers a viewer for endpointID's events.
func (h *Hub) Subscribe(ctx context.Context, endpointID uuid.UUID) (*Subscriber, error) {
	channel := live.Channel(endpointID)
	s := &Subscriber{channel: channel, events: make(chan []byte, subscriberBuffer), done: make(chan struct{})}

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, ErrClosed
	}
	if len(h.subs[channel]) == 0 {
		if err := h.ps.Subscribe(ctx, channel); err != nil {
			return nil, err
		}
		h.subs[channel] = map[*Subscriber]struct{}{}
	}
	h.subs[channel][s] = struct{}{}
	return s, nil
}

// Unsubscribe removes a viewer; the Redis channel is released with the last one.
func (h *Hub) Unsubscribe(ctx context.Context, s *Subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeLocked(ctx, s)
}

func (h *Hub) removeLocked(ctx context.Context, s *Subscriber) {
	set, ok := h.subs[s.channel]
	if !ok {
		return
	}
	if _, ok := set[s]; !ok {
		return
	}
	delete(set, s)
	if len(set) == 0 {
		delete(h.subs, s.channel)
		if !h.closed {
			// Best effort: a stale subscription only costs ignored messages.
			if err := h.ps.Unsubscribe(ctx, s.channel); err != nil {
				h.logger.DebugContext(ctx, "redis unsubscribe failed", "error", err)
			}
		}
	}
}

// Viewers returns how many local viewers are connected.
func (h *Hub) Viewers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, set := range h.subs {
		n += len(set)
	}
	return n
}

// Shutdown tells every viewer to reconnect and closes the Redis subscription.
// Register it with http.Server.RegisterOnShutdown so open streams do not hold
// up a graceful shutdown.
func (h *Hub) Shutdown() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	for _, set := range h.subs {
		for s := range set {
			s.close(ReasonShutdown)
		}
	}
	h.subs = map[string]map[*Subscriber]struct{}{}
	_ = h.ps.Close()
}
