// Package pubsub multiplexes Redis pub/sub channels across local consumers.
//
// A Hub holds a single Redis pub/sub connection. It subscribes to a channel
// when the first local consumer arrives and unsubscribes when the last one
// leaves, then fans every message out in memory. A consumer that cannot keep
// up is disconnected (it reconnects and resumes) instead of slowing everyone
// else down. SSE viewers and CLI tunnels each use their own Hub.
package pubsub

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// subscriberBuffer is how many messages a consumer may fall behind before it is cut off.
const subscriberBuffer = 256

// Close reasons.
const (
	ReasonShutdown = "shutdown" // the edge is restarting; reconnect elsewhere
	ReasonLagging  = "lagging"  // the viewer fell too far behind
)

// ErrClosed is returned by Subscribe after Shutdown.
var ErrClosed = errors.New("pubsub hub is shut down")

// Subscriber receives one channel's raw messages.
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

// confirmTimeout bounds how long Subscribe waits for Redis to confirm a new
// channel. Confirmation normally takes well under a millisecond; past this,
// Subscribe returns anyway, as it did before confirmations were awaited.
const confirmTimeout = 2 * time.Second

// Hub multiplexes one Redis subscription across local viewers.
type Hub struct {
	ps     *redis.PubSub
	logger *slog.Logger

	mu     sync.Mutex
	subs   map[string]map[*Subscriber]struct{}
	closed bool
	// pending holds a channel per Redis channel whose SUBSCRIBE has been sent
	// but not yet confirmed; it is closed when the confirmation arrives.
	pending map[string]chan struct{}
}

// NewHub returns a Hub on rdb. Call Run to start delivering messages.
func NewHub(rdb *redis.Client, logger *slog.Logger) *Hub {
	return &Hub{
		// No channels yet: they are added as viewers subscribe.
		ps:      rdb.Subscribe(context.Background()),
		logger:  logger,
		subs:    map[string]map[*Subscriber]struct{}{},
		pending: map[string]chan struct{}{},
	}
}

// Run dispatches messages until ctx ends. go-redis reconnects and
// resubscribes on its own when Redis restarts.
func (h *Hub) Run(ctx context.Context) {
	ch := h.ps.ChannelWithSubscriptions(redis.WithChannelSize(1024))
	for {
		select {
		case <-ctx.Done():
			h.Shutdown()
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			switch m := msg.(type) {
			case *redis.Message:
				h.dispatch(ctx, m.Channel, []byte(m.Payload))
			case *redis.Subscription:
				if m.Kind == "subscribe" {
					h.confirmed(m.Channel)
				}
			}
		}
	}
}

func (h *Hub) confirmed(channel string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.releasePendingLocked(channel)
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

// Subscribe registers a consumer of channel.
//
// It returns once Redis has confirmed the subscription, so a message
// published right after Subscribe returns is delivered: go-redis only writes
// SUBSCRIBE, and a PUBLISH on another connection could otherwise reach Redis
// first and be lost (a sync answer, a tunnel's first request).
func (h *Hub) Subscribe(ctx context.Context, channel string) (*Subscriber, error) {
	s := &Subscriber{channel: channel, events: make(chan []byte, subscriberBuffer), done: make(chan struct{})}

	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return nil, ErrClosed
	}
	if len(h.subs[channel]) == 0 {
		confirm := make(chan struct{})
		h.pending[channel] = confirm
		if err := h.ps.Subscribe(ctx, channel); err != nil {
			delete(h.pending, channel)
			h.mu.Unlock()
			return nil, err
		}
		h.subs[channel] = map[*Subscriber]struct{}{}
	}
	h.subs[channel][s] = struct{}{}
	confirm := h.pending[channel] // nil once confirmed
	h.mu.Unlock()

	if confirm != nil {
		timer := time.NewTimer(confirmTimeout)
		defer timer.Stop()
		select {
		case <-confirm:
		case <-timer.C:
			h.logger.WarnContext(ctx, "redis subscription not confirmed in time", "channel", channel)
		case <-ctx.Done():
			h.Unsubscribe(context.WithoutCancel(ctx), s)
			return nil, ctx.Err()
		}
	}
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
		h.releasePendingLocked(s.channel)
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
	for channel := range h.pending {
		h.releasePendingLocked(channel)
	}
	_ = h.ps.Close()
}

// releasePendingLocked wakes anyone waiting for channel's confirmation.
func (h *Hub) releasePendingLocked(channel string) {
	if c, ok := h.pending[channel]; ok {
		close(c)
		delete(h.pending, channel)
	}
}
