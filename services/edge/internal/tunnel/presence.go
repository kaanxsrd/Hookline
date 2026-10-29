package tunnel

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Sessions are tracked in Redis sorted sets scored by expiry (Unix ms), so a
// crashed edge's sessions age out on their own. Sessions refresh their entry
// on every ping.
const presenceTTL = 90 * time.Second

func orgKey(orgID uuid.UUID) string { return "tunnel:org:" + orgID.String() }

// EndpointKey holds the sessions listening on an endpoint; the web app counts
// them to show connected CLIs.
func EndpointKey(endpointID uuid.UUID) string { return "tunnel:ep-sessions:" + endpointID.String() }

// acquire adds the session to its organization's set unless limit (> 0) live
// sessions are already there.
var acquireScript = redis.NewScript(`
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local limit = tonumber(ARGV[4])
if limit > 0 and redis.call('ZCARD', KEYS[1]) >= limit then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`)

// Presence tracks live sessions.
type Presence struct {
	RDB *redis.Client
	Now func() time.Time
}

// Acquire claims a tunnel slot for the organization. It fails open (true)
// when Redis is unreachable, returning the error for logging.
func (p *Presence) Acquire(ctx context.Context, orgID uuid.UUID, session string, limit int) (bool, error) {
	now := p.Now()
	ok, err := acquireScript.Run(ctx, p.RDB, []string{orgKey(orgID)},
		now.UnixMilli(), now.Add(presenceTTL).UnixMilli(), session, limit, presenceTTL.Milliseconds()).Int()
	if err != nil {
		return true, err
	}
	return ok == 1, nil
}

// Join records the session on each endpoint and announces the new counts.
func (p *Presence) Join(ctx context.Context, session string, endpoints []uuid.UUID) error {
	return p.touch(ctx, session, endpoints, true)
}

// Refresh extends the session's entries.
func (p *Presence) Refresh(ctx context.Context, orgID uuid.UUID, session string, endpoints []uuid.UUID) error {
	expiry := float64(p.Now().Add(presenceTTL).UnixMilli())
	pipe := p.RDB.Pipeline()
	pipe.ZAddXX(ctx, orgKey(orgID), redis.Z{Score: expiry, Member: session})
	for _, ep := range endpoints {
		pipe.ZAddXX(ctx, EndpointKey(ep), redis.Z{Score: expiry, Member: session})
	}
	_, err := pipe.Exec(ctx)
	return err
}

// Leave removes the session everywhere and announces the new counts.
func (p *Presence) Leave(ctx context.Context, orgID uuid.UUID, session string, endpoints []uuid.UUID) error {
	if err := p.RDB.ZRem(ctx, orgKey(orgID), session).Err(); err != nil {
		return err
	}
	return p.touch(ctx, session, endpoints, false)
}

func (p *Presence) touch(ctx context.Context, session string, endpoints []uuid.UUID, join bool) error {
	now := p.Now()
	for _, ep := range endpoints {
		key := EndpointKey(ep)
		pipe := p.RDB.TxPipeline()
		if join {
			pipe.ZAdd(ctx, key, redis.Z{Score: float64(now.Add(presenceTTL).UnixMilli()), Member: session})
			pipe.PExpire(ctx, key, presenceTTL)
		} else {
			pipe.ZRem(ctx, key, session)
		}
		pipe.ZRemRangeByScore(ctx, key, "-inf", strconv.FormatInt(now.UnixMilli(), 10))
		count := pipe.ZCard(ctx, key)
		if _, err := pipe.Exec(ctx); err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]any{
			"type":    "tunnels",
			"payload": map[string]any{"endpoint_id": ep, "count": count.Val()},
		})
		if err != nil {
			return err
		}
		// The dashboard's live stream shows the connected CLI count.
		if err := p.RDB.Publish(ctx, "ep:"+ep.String(), payload).Err(); err != nil {
			return err
		}
	}
	return nil
}
