package pubsub_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/services/edge/internal/pubsub"
)

// A message published right after Subscribe returns must arrive: Subscribe
// waits for Redis to confirm the channel (a sync answer or a tunnel's first
// request is published from another connection immediately afterwards).
func TestSubscribeIsConfirmedBeforeReturning(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	hub := pubsub.NewHub(rdb, logging.Discard())
	go hub.Run(t.Context())

	for i := range 50 {
		channel := fmt.Sprintf("tunnel:resp:%d", i)
		start := time.Now()
		sub, err := hub.Subscribe(t.Context(), channel)
		require.NoError(t, err)
		assert.Less(t, time.Since(start), time.Second, "confirmation arrives long before the timeout")

		require.NoError(t, rdb.Publish(t.Context(), channel, "answer").Err())
		select {
		case got := <-sub.Events():
			assert.Equal(t, "answer", string(got))
		case <-time.After(2 * time.Second):
			t.Fatalf("message %d published right after Subscribe was lost", i)
		}
		hub.Unsubscribe(t.Context(), sub)
	}
}

func TestSubscribeAfterShutdown(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	hub := pubsub.NewHub(rdb, logging.Discard())
	hub.Shutdown()
	_, err := hub.Subscribe(t.Context(), "x")
	require.ErrorIs(t, err, pubsub.ErrClosed)
}
