package deliver

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RedisPublisher publishes delivery events on the endpoint channel the edge
// fans out to dashboards ("ep:{endpointId}", see the edge's live package).
type RedisPublisher struct {
	RDB *redis.Client
}

type liveEvent struct {
	Type    string `json:"type"`
	Payload Event  `json:"payload"`
}

// PublishDelivery implements Publisher.
func (p RedisPublisher) PublishDelivery(ctx context.Context, endpointID uuid.UUID, event Event) error {
	msg, err := json.Marshal(liveEvent{Type: "delivery", Payload: event})
	if err != nil {
		return err
	}
	if err := p.RDB.Publish(ctx, "ep:"+endpointID.String(), msg).Err(); err != nil {
		return fmt.Errorf("publish delivery event: %w", err)
	}
	return nil
}
