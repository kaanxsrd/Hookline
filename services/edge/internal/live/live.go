// Package live carries captured-request events between edge instances over
// Redis pub/sub. Every instance publishes to ep:{endpointId}; instances with
// dashboard subscribers fan the events out over SSE.
package live

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Channel is the Redis channel for an endpoint's events.
func Channel(endpointID uuid.UUID) string { return "ep:" + endpointID.String() }

// RequestSummary is what the dashboard needs to render a request row. It
// never contains header values or the body.
type RequestSummary struct {
	ID              uuid.UUID `json:"id"`
	EndpointID      uuid.UUID `json:"endpoint_id"`
	Method          string    `json:"method"`
	Path            string    `json:"path"`
	ContentType     string    `json:"content_type,omitempty"`
	BodySize        int       `json:"body_size"`
	SourceIP        string    `json:"source_ip,omitempty"`
	SignatureStatus string    `json:"signature_status"`
	ResponseStatus  int       `json:"response_status"`
	ReceivedAt      time.Time `json:"received_at"`
}

// Event is one message on an endpoint channel.
type Event struct {
	Type    string          `json:"type"` // "request", "delivery" or "endpoint"
	Payload json.RawMessage `json:"payload"`
}

// Publisher publishes endpoint events.
type Publisher struct {
	rdb *redis.Client
}

// NewPublisher returns a Publisher on rdb.
func NewPublisher(rdb *redis.Client) *Publisher {
	return &Publisher{rdb: rdb}
}

// PublishRequest announces a newly captured request.
func (p *Publisher) PublishRequest(ctx context.Context, s RequestSummary) error {
	payload, err := json.Marshal(s)
	if err != nil {
		return err
	}
	msg, err := json.Marshal(Event{Type: "request", Payload: payload})
	if err != nil {
		return err
	}
	if err := p.rdb.Publish(ctx, Channel(s.EndpointID), msg).Err(); err != nil {
		return fmt.Errorf("publish request event: %w", err)
	}
	return nil
}
