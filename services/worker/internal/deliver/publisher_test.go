package deliver_test

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/services/worker/internal/deliver"
)

func TestRedisPublisher(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	endpoint := uuid.New()
	sub := rdb.Subscribe(t.Context(), "ep:"+endpoint.String())
	t.Cleanup(func() { _ = sub.Close() })
	_, err := sub.Receive(t.Context())
	require.NoError(t, err)

	ev := deliver.Event{RequestID: uuid.New(), DeliveryID: uuid.New(), Status: "succeeded", Statuses: []string{"succeeded"}}
	require.NoError(t, deliver.RedisPublisher{RDB: rdb}.PublishDelivery(t.Context(), endpoint, ev))
	msg, err := sub.ReceiveMessage(t.Context())
	require.NoError(t, err)
	assert.JSONEq(t, `{"type":"delivery","payload":{"request_id":"`+ev.RequestID.String()+`","delivery_id":"`+ev.DeliveryID.String()+`","status":"succeeded","statuses":["succeeded"]}}`, msg.Payload)
}
