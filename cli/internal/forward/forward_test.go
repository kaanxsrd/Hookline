package forward_test

import (
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/cli/internal/forward"
	"github.com/kaanxsrd/hookline/packages/protocol"
)

func request(path, query, body string) protocol.Request {
	return protocol.Request{
		ID: "01890000-0000-7000-8000-000000000001", Method: "POST", Path: path, Query: query,
		Headers: []protocol.Header{
			{"Host", "hooks.example.com"}, {"Content-Type", "application/json"}, {"Stripe-Signature", "t=1,v1=abc"},
			{"Connection", "keep-alive"}, {"Content-Length", "99"}, {"X-Multi", "a"}, {"X-Multi", "b"},
		},
		BodyB64: base64.StdEncoding.EncodeToString([]byte(body)),
	}
}

func TestURL(t *testing.T) {
	f, err := forward.New("http://localhost:3000/api/webhooks?src=hookline", []forward.Rewrite{{From: "/stripe", To: "/payments"}}, nil)
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:3000/api/webhooks/payments/events?src=hookline&a=1",
		f.URL(request("/stripe/events", "a=1", "")).String())
	assert.Equal(t, "http://localhost:3000/api/webhooks/stripeish?src=hookline",
		f.URL(request("/stripeish", "", "")).String(), "rewrites match whole segments")
	assert.Equal(t, "http://localhost:3000/api/webhooks?src=hookline", f.URL(request("/", "", "")).String())
}

func TestHandleForwardsFaithfully(t *testing.T) {
	var got *http.Request
	var body []byte
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		body, _ = io.ReadAll(r.Body)
		w.Header().Set("X-Reply", "ok")
		w.WriteHeader(http.StatusAccepted)
		_, _ = io.WriteString(w, "done")
	}))
	defer local.Close()

	f, err := forward.New(local.URL, nil, [][2]string{{"Authorization", "Bearer local"}})
	require.NoError(t, err)
	resp, perr := f.Handle(t.Context(), request("/hook", "x=1", `{"a":1}`))
	require.Nil(t, perr)
	assert.Equal(t, http.StatusAccepted, resp.Status)
	reply, _ := base64.StdEncoding.DecodeString(resp.BodyB64)
	assert.Equal(t, "done", string(reply))
	assert.Contains(t, resp.Headers, protocol.Header{"X-Reply", "ok"})

	assert.Equal(t, "/hook", got.URL.Path)
	assert.Equal(t, "x=1", got.URL.RawQuery)
	assert.JSONEq(t, `{"a":1}`, string(body))
	assert.Equal(t, "t=1,v1=abc", got.Header.Get("Stripe-Signature"))
	assert.Equal(t, []string{"a", "b"}, got.Header.Values("X-Multi"))
	assert.Equal(t, "Bearer local", got.Header.Get("Authorization"))
	assert.Equal(t, "01890000-0000-7000-8000-000000000001", got.Header.Get("X-Hookline-Request-Id"))
	assert.NotEqual(t, "hooks.example.com", got.Host, "the local server sees its own host")
}

func TestHandleReportsUnreachableTargets(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := ln.Addr().String()
	require.NoError(t, ln.Close())

	f, err := forward.New("http://"+addr, nil, nil)
	require.NoError(t, err)
	_, perr := f.Handle(t.Context(), request("/", "", ""))
	require.NotNil(t, perr)
	assert.Equal(t, protocol.CodeTargetUnreachable, perr.Code)
	assert.Contains(t, perr.Message, "connection refused")
}

func TestHandleTimesOutAtTheSyncDeadline(t *testing.T) {
	block := make(chan struct{})
	local := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { <-block }))
	defer local.Close()
	defer close(block)

	f, err := forward.New(local.URL, nil, nil)
	require.NoError(t, err)
	req := request("/", "", "")
	req.SyncDeadlineMS = 200
	start := time.Now()
	_, perr := f.Handle(context.Background(), req)
	require.NotNil(t, perr)
	assert.Equal(t, protocol.CodeTimeout, perr.Code)
	assert.Less(t, time.Since(start), 2*time.Second)
}

func TestParsing(t *testing.T) {
	rw, err := forward.ParseRewrite("/a=/b")
	require.NoError(t, err)
	assert.Equal(t, forward.Rewrite{From: "/a", To: "/b"}, rw)
	_, err = forward.ParseRewrite("a=b")
	require.Error(t, err)

	h, err := forward.ParseHeader("X-Key: secret value")
	require.NoError(t, err)
	assert.Equal(t, [2]string{"X-Key", "secret value"}, h)
	_, err = forward.ParseHeader("no colon")
	require.Error(t, err)
	_, err = forward.ParseHeader("Bad Name: x")
	require.Error(t, err)

	_, err = forward.New("localhost:3000", nil, nil)
	require.Error(t, err)
}
