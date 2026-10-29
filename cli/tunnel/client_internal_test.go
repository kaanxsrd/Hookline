package tunnel

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBackoffStaysWithinBounds(t *testing.T) {
	for attempt := 1; attempt < 40; attempt++ {
		d := backoff(attempt, time.Second, 30*time.Second)
		assert.GreaterOrEqual(t, d, time.Second)
		assert.LessOrEqual(t, d, 30*time.Second)
	}
	assert.Equal(t, time.Second, backoff(1, time.Second, 30*time.Second), "the first retry waits the minimum")
}

func TestRecentSetForgetsTheOldest(t *testing.T) {
	s := newRecentSet(2)
	assert.True(t, s.add("a"))
	assert.False(t, s.add("a"))
	assert.True(t, s.add("b"))
	assert.True(t, s.add("c"))
	assert.True(t, s.add("a"), "a was evicted")
}

func TestHandshakeErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/busy") {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"code":"shutting_down","message":"restarting"}}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"Run hookline login."}}`))
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/v1/tunnel")
	require.NoError(t, err)
	var fatal *FatalError
	require.ErrorAs(t, handshakeError(resp, errors.New("dial failed")), &fatal)
	assert.Equal(t, "Run hookline login.", fatal.Message)

	resp, err = http.Get(srv.URL + "/busy")
	require.NoError(t, err)
	err = handshakeError(resp, errors.New("dial failed"))
	require.NotErrorAs(t, err, &fatal, "a restarting edge is retried")
	assert.Contains(t, err.Error(), "restarting")
}
