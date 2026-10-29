// Package tunnel serves CLI tunnels (protocol hookline.v1, see
// docs/tunnel-protocol.md) and relays captured requests to them.
//
// Routing works across edge instances through Redis: intake publishes each
// request on tunnel:ep:{endpointId}; every instance holding a tunnel for that
// endpoint is subscribed (one Redis connection per process, shared through a
// pubsub.Hub) and forwards it to its sessions. In sync mode intake first
// subscribes to tunnel:resp:{requestId}, where sessions publish what their
// CLI answered; the first answer wins.
package tunnel

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/kaanxsrd/hookline/packages/protocol"
	"github.com/kaanxsrd/hookline/services/edge/internal/pubsub"
)

// RequestChannel carries an endpoint's requests to tunnels.
func RequestChannel(endpointID uuid.UUID) string { return "tunnel:ep:" + endpointID.String() }

// ResponseChannel carries a CLI's answer to one request back to intake.
func ResponseChannel(requestID string) string { return "tunnel:resp:" + requestID }

// frameOverhead leaves room for everything but the body in a request frame.
const frameOverhead = 64 << 10

// maxInlineBody is the largest body sent inside a frame (base64 grows it by 4/3).
const maxInlineBody = (protocol.MaxMessageBytes - frameOverhead) / 4 * 3

var (
	// ErrNoTunnel means no edge instance has a tunnel open for the endpoint.
	ErrNoTunnel = errors.New("no tunnel connected")
	// ErrTimeout means no CLI answered before the deadline.
	ErrTimeout = errors.New("no tunnel response before the deadline")
	// ErrTargetFailed means the CLI reported that its local target failed.
	ErrTargetFailed = errors.New("the tunnel's local target failed")
)

// NewRequest builds a request frame, leaving the body out when it would not
// fit in a frame.
func NewRequest(id, endpointID uuid.UUID, method, path, query string, headers []protocol.Header, body []byte, receivedAt time.Time) protocol.Request {
	req := protocol.Request{
		Type:       protocol.TypeRequest,
		ID:         id.String(),
		EndpointID: endpointID.String(),
		Method:     method,
		Path:       path,
		Query:      query,
		Headers:    headers,
		BodySize:   len(body),
		ReceivedAt: receivedAt.UTC(),
	}
	if req.Headers == nil {
		req.Headers = []protocol.Header{}
	}
	if len(body) > maxInlineBody {
		req.BodyOmitted = true
	} else {
		req.BodyB64 = base64.StdEncoding.EncodeToString(body)
	}
	return req
}

// Relay publishes requests to tunnels and waits for sync answers.
type Relay struct {
	RDB *redis.Client
	// Responses is a Hub dedicated to response channels.
	Responses *pubsub.Hub
}

// Offer publishes req to the endpoint's tunnels. With wait > 0 it waits up to
// that long for the first CLI response; otherwise it returns at once.
func (r *Relay) Offer(ctx context.Context, endpointID uuid.UUID, req protocol.Request, wait time.Duration) (*protocol.Response, error) {
	if wait <= 0 {
		msg, err := json.Marshal(req)
		if err != nil {
			return nil, err
		}
		return nil, r.RDB.Publish(ctx, RequestChannel(endpointID), msg).Err()
	}

	// Subscribe before publishing so a fast answer cannot be missed.
	sub, err := r.Responses.Subscribe(ctx, ResponseChannel(req.ID))
	if err != nil {
		return nil, fmt.Errorf("subscribe to tunnel response: %w", err)
	}
	defer r.Responses.Unsubscribe(context.WithoutCancel(ctx), sub)

	req.SyncDeadlineMS = int(wait / time.Millisecond)
	msg, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	receivers, err := r.RDB.Publish(ctx, RequestChannel(endpointID), msg).Result()
	if err != nil {
		return nil, err
	}
	if receivers == 0 {
		return nil, ErrNoTunnel
	}

	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
			return nil, ErrTimeout
		case <-sub.Done():
			return nil, ErrTimeout
		case raw := <-sub.Events():
			typ, _, err := protocol.Peek(raw)
			if err != nil {
				continue
			}
			switch typ {
			case protocol.TypeResponse:
				var resp protocol.Response
				if protocol.Decode(raw, &resp) != nil || resp.Validate() != nil {
					continue
				}
				return &resp, nil
			case protocol.TypeError:
				// The sender should not wait out the deadline for a target
				// that already failed; the static response answers instead.
				return nil, ErrTargetFailed
			default:
				// Nothing else is published on response channels.
			}
		}
	}
}
