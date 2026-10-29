package stream_test

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/clientip"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbtest"
	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/services/edge/internal/endpoints"
	"github.com/kaanxsrd/hookline/services/edge/internal/intake"
	"github.com/kaanxsrd/hookline/services/edge/internal/live"
	"github.com/kaanxsrd/hookline/services/edge/internal/metrics"
	"github.com/kaanxsrd/hookline/services/edge/internal/server"
	"github.com/kaanxsrd/hookline/services/edge/internal/stream"
	"github.com/kaanxsrd/hookline/services/edge/internal/streamauth"
)

func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }

const secret = "stream-test-secret-0123456789abcdef"

type env struct {
	t        *testing.T
	pool     *pgxpool.Pool
	mr       *miniredis.Miniredis
	hub      *stream.Hub
	srv      *httptest.Server
	endpoint uuid.UUID
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pool := dbtest.New(t)
	q := dbq.New(pool)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	m := metrics.New()
	hub := stream.NewHub(rdb, logging.Discard())
	ctx, cancel := context.WithCancel(context.Background())
	go hub.Run(ctx)
	t.Cleanup(cancel)

	tokens, err := streamauth.NewVerifier(secret)
	require.NoError(t, err)
	trusted, _ := clientip.ParseTrusted(clientip.DefaultTrusted)
	handler := server.New(logging.Discard(), server.Routes{
		Intake: intake.New(intake.Deps{
			Queries: q, Endpoints: endpoints.NewCache(q, rdb, "", logging.Discard()),
			Publisher: live.NewPublisher(rdb), IPs: clientip.New(trusted), Metrics: m, Logger: logging.Discard(),
		}),
		Stream: &stream.Handler{
			Hub: hub, Queries: q, Tokens: tokens, AllowOrigin: "http://localhost:3000",
			Metrics: m, Logger: logging.Discard(), PingInterval: 200 * time.Millisecond,
		},
	})
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	e := &env{t: t, pool: pool, mr: mr, hub: hub, srv: srv}
	require.NoError(t, pool.QueryRow(t.Context(), `
		INSERT INTO endpoint (slug, name, expires_at) VALUES ('streamSlug01', 'x', now() + interval '1 day') RETURNING id`,
	).Scan(&e.endpoint))
	return e
}

func (e *env) token(ep uuid.UUID) string {
	now := time.Now()
	return streamauth.Sign(secret, streamauth.Claims{Subject: "anonymous", Endpoint: ep, Expires: now.Add(5 * time.Minute)}, now)
}

// capture sends a webhook through intake and returns its request ID.
func (e *env) capture(body string) string {
	e.t.Helper()
	resp, err := http.Post(e.srv.URL+"/h/streamSlug01/x", "application/json", strings.NewReader(body))
	require.NoError(e.t, err)
	defer resp.Body.Close()
	require.Equal(e.t, http.StatusOK, resp.StatusCode)
	return resp.Header.Get(httpx.RequestIDHeader)
}

type event struct{ name, id, data string }

type client struct {
	t      *testing.T
	resp   *http.Response
	events chan event
	cancel context.CancelFunc
}

func (e *env) connect(query string, header http.Header) *client {
	e.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, e.srv.URL+"/v1/stream/"+e.endpoint.String()+"?"+query, nil)
	require.NoError(e.t, err)
	for k, v := range header {
		req.Header[k] = v
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(e.t, err)
	c := &client{t: e.t, resp: resp, events: make(chan event, 1024), cancel: cancel}
	e.t.Cleanup(c.close)
	if resp.StatusCode != http.StatusOK {
		return c
	}
	go func() {
		defer close(c.events)
		sc := bufio.NewScanner(resp.Body)
		var ev event
		for sc.Scan() {
			line := sc.Text()
			switch {
			case line == "":
				if ev.name != "" {
					c.events <- ev
				}
				ev = event{}
			case strings.HasPrefix(line, "event: "):
				ev.name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "id: "):
				ev.id = strings.TrimPrefix(line, "id: ")
			case strings.HasPrefix(line, "data: "):
				ev.data = strings.TrimPrefix(line, "data: ")
			}
		}
	}()
	return c
}

func (c *client) close() {
	c.cancel()
	_ = c.resp.Body.Close()
}

// next returns the next event that is not a ping.
func (c *client) next() event {
	c.t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case ev, ok := <-c.events:
			if !ok {
				c.t.Fatal("stream closed")
			}
			if ev.name != "ping" {
				return ev
			}
		case <-timeout:
			c.t.Fatal("timed out waiting for an event")
		}
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	require.Eventually(t, cond, 5*time.Second, 10*time.Millisecond)
}

func TestAuthorization(t *testing.T) {
	t.Parallel()
	e := newEnv(t)

	c := e.connect("", nil)
	assert.Equal(t, http.StatusUnauthorized, c.resp.StatusCode)

	c = e.connect("token=garbage", nil)
	assert.Equal(t, http.StatusUnauthorized, c.resp.StatusCode)

	c = e.connect("token="+e.token(uuid.New()), nil)
	assert.Equal(t, http.StatusForbidden, c.resp.StatusCode, "token for another endpoint")

	resp, err := http.Get(e.srv.URL + "/v1/stream/not-a-uuid?token=x")
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestLiveEventsReachEveryViewer(t *testing.T) {
	t.Parallel()
	e := newEnv(t)

	clients := make([]*client, 5)
	for i := range clients {
		clients[i] = e.connect("token="+e.token(e.endpoint), nil)
		require.Equal(t, http.StatusOK, clients[i].resp.StatusCode)
		assert.Equal(t, "text/event-stream; charset=utf-8", clients[i].resp.Header.Get("Content-Type"))
		assert.Equal(t, "http://localhost:3000", clients[i].resp.Header.Get("Access-Control-Allow-Origin"))
	}
	waitFor(t, func() bool { return e.hub.Viewers() == 5 })
	assert.Equal(t, 1, e.mr.PubSubNumSub(live.Channel(e.endpoint))[live.Channel(e.endpoint)],
		"one Redis subscription per process, not per viewer")

	id := e.capture(`{"n":1}`)
	for _, c := range clients {
		ev := c.next()
		assert.Equal(t, "request", ev.name)
		assert.Equal(t, id, ev.id)
		var s live.RequestSummary
		require.NoError(t, json.Unmarshal([]byte(ev.data), &s))
		assert.Equal(t, "/x", s.Path)
		assert.Equal(t, 7, s.BodySize)
	}

	for _, c := range clients {
		c.close()
	}
	waitFor(t, func() bool { return e.hub.Viewers() == 0 })
	waitFor(t, func() bool { return e.mr.PubSubNumSub(live.Channel(e.endpoint))[live.Channel(e.endpoint)] == 0 })
}

func TestResumeReplaysMissedRequestsOnce(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	first := e.capture(`{"n":0}`)
	var missed []string
	for i := 1; i <= 3; i++ {
		missed = append(missed, e.capture(`{"n":1}`))
	}

	// Header form (EventSource's automatic reconnect).
	c := e.connect("token="+e.token(e.endpoint), http.Header{"Last-Event-Id": {first}})
	require.Equal(t, http.StatusOK, c.resp.StatusCode)
	for _, want := range missed {
		ev := c.next()
		assert.Equal(t, "request", ev.name)
		assert.Equal(t, want, ev.id)
	}
	live := e.capture(`{"n":2}`)
	assert.Equal(t, live, c.next().id, "then live events, without duplicates")

	// Query form (manual reconnect with a fresh token).
	c2 := e.connect("token="+e.token(e.endpoint)+"&last_event_id="+missed[1], nil)
	assert.Equal(t, missed[2], c2.next().id)
	assert.Equal(t, live, c2.next().id)
}

func TestResyncWhenTooManyMissed(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	before, err := uuid.NewV7()
	require.NoError(t, err)
	time.Sleep(2 * time.Millisecond)
	_, err = e.pool.Exec(t.Context(), `
		INSERT INTO request (endpoint_id, method, path) SELECT $1, 'POST', '/' FROM generate_series(1, $2::int)`,
		e.endpoint, stream.MaxReplay+1)
	require.NoError(t, err)

	c := e.connect("token="+e.token(e.endpoint)+"&last_event_id="+before.String(), nil)
	for range stream.MaxReplay {
		require.Equal(t, "request", c.next().name)
	}
	ev := c.next()
	assert.Equal(t, "resync", ev.name)
	assert.JSONEq(t, `{"reason":"too_many_missed"}`, ev.data)
}

func TestPings(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	c := e.connect("token="+e.token(e.endpoint), nil)
	select {
	case ev := <-c.events:
		assert.Equal(t, "ping", ev.name)
	case <-time.After(3 * time.Second):
		t.Fatal("no ping")
	}
}

func TestShutdownAsksViewersToReconnect(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	c := e.connect("token="+e.token(e.endpoint), nil)
	waitFor(t, func() bool { return e.hub.Viewers() == 1 })

	e.hub.Shutdown()
	ev := c.next()
	assert.Equal(t, "reconnect", ev.name)
	_, open := <-c.events
	assert.False(t, open, "the stream ends after the reconnect event")

	_, err := e.hub.Subscribe(t.Context(), e.endpoint)
	require.ErrorIs(t, err, stream.ErrClosed)
}

func TestLaggingViewerIsDisconnected(t *testing.T) {
	t.Parallel()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	hub := stream.NewHub(rdb, logging.Discard())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	ep := uuid.New()
	slow, err := hub.Subscribe(t.Context(), ep)
	require.NoError(t, err)
	for i := range 300 {
		require.NoError(t, rdb.Publish(t.Context(), live.Channel(ep), `{"type":"ping","payload":{}}`).Err(), i)
	}
	select {
	case <-slow.Done():
		assert.Equal(t, stream.ReasonLagging, slow.Reason())
	case <-time.After(5 * time.Second):
		t.Fatal("slow viewer was not disconnected")
	}
	assert.Zero(t, hub.Viewers())
}
