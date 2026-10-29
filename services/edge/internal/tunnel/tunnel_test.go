package tunnel_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/cli/tunnel"
	"github.com/kaanxsrd/hookline/packages/gocommon/clientip"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbtest"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/packages/protocol"
	"github.com/kaanxsrd/hookline/services/edge/internal/apikey"
	"github.com/kaanxsrd/hookline/services/edge/internal/endpoints"
	"github.com/kaanxsrd/hookline/services/edge/internal/intake"
	"github.com/kaanxsrd/hookline/services/edge/internal/metrics"
	"github.com/kaanxsrd/hookline/services/edge/internal/pubsub"
	"github.com/kaanxsrd/hookline/services/edge/internal/server"
	edgetunnel "github.com/kaanxsrd/hookline/services/edge/internal/tunnel"
)

func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }

const (
	apiKey = "hk_live_TunnelTestKey0123456789abcdefghijABCDEFGHIJ"
	slug   = "tunnelSlug01"
)

// instance is one edge process: intake and tunnels on its own Redis hubs.
type instance struct {
	handler http.Handler
	tunnels *edgetunnel.Server
	cancel  context.CancelFunc
}

type env struct {
	t        *testing.T
	pool     *pgxpool.Pool
	mr       *miniredis.Miniredis
	org      uuid.UUID
	endpoint uuid.UUID
	a, b     *instance
	intake   *httptest.Server // instance A's public listener
	lb       *httptest.Server // where CLIs connect; routes to `current`
	current  atomic.Pointer[instance]
	local    *localServer
}

func newInstance(t *testing.T, pool *pgxpool.Pool, mr *miniredis.Miniredis) *instance {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	q := dbq.New(pool)
	m := metrics.New()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	requests, responses := pubsub.NewHub(rdb, logging.Discard()), pubsub.NewHub(rdb, logging.Discard())
	go requests.Run(ctx)
	go responses.Run(ctx)

	tunnels := edgetunnel.NewServer(edgetunnel.Deps{
		Keys:     &apikey.Authenticator{Queries: q, Logger: logging.Discard()},
		Queries:  q,
		RDB:      rdb,
		Hub:      requests,
		Presence: &edgetunnel.Presence{RDB: rdb, Now: time.Now},
		// miniredis needs time to be moved explicitly; presence uses wall time scores only.
		PublicURL:    "https://hooks.example.test",
		Metrics:      m,
		Logger:       logging.Discard(),
		PingInterval: 200 * time.Millisecond,
	})
	trusted, _ := clientip.ParseTrusted(clientip.DefaultTrusted)
	handler := server.New(logging.Discard(), server.Routes{
		Intake: intake.New(intake.Deps{
			Pool: pool, Queries: q, Endpoints: endpoints.NewCache(q, rdb, "", logging.Discard()),
			Tunnels: &edgetunnel.Relay{RDB: rdb, Responses: responses},
			IPs:     clientip.New(trusted), Metrics: m, Logger: logging.Discard(),
		}),
		Tunnel: tunnels,
	})
	return &instance{handler: handler, tunnels: tunnels, cancel: cancel}
}

// localServer stands in for the developer's app on localhost.
type localServer struct {
	*httptest.Server
	mu       sync.Mutex
	received []*http.Request
	bodies   []string
	status   atomic.Int32
}

func newLocal(t *testing.T) *localServer {
	l := &localServer{}
	l.status.Store(http.StatusCreated)
	l.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		l.mu.Lock()
		l.received = append(l.received, r)
		l.bodies = append(l.bodies, string(body))
		l.mu.Unlock()
		w.Header().Set("X-Local", "yes")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(int(l.status.Load()))
		_, _ = io.WriteString(w, `{"handled":"`+r.URL.Path+`"}`)
	}))
	t.Cleanup(l.Close)
	return l
}

func (l *localServer) count() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.received)
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pool := dbtest.New(t)
	mr := miniredis.RunT(t)
	e := &env{t: t, pool: pool, mr: mr, local: newLocal(t)}
	e.a = newInstance(t, pool, mr)
	e.b = newInstance(t, pool, mr)
	e.intake = httptest.NewServer(e.a.handler)
	t.Cleanup(e.intake.Close)
	e.current.Store(e.b)
	e.lb = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		e.current.Load().handler.ServeHTTP(w, r)
	}))
	t.Cleanup(e.lb.Close)

	ctx := t.Context()
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO organization (name, slug) VALUES ('Org', 'org') RETURNING id`).Scan(&e.org))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO endpoint (org_id, slug, name) VALUES ($1, $2, 'Tunnel test') RETURNING id`, e.org, slug).Scan(&e.endpoint))
	sum := sha256.Sum256([]byte(apiKey))
	_, err := pool.Exec(ctx, `INSERT INTO api_key (org_id, name, prefix, hash, scopes) VALUES ($1, 'k', 'hk_live_Tunn', $2, '{tunnel}')`, e.org, sum[:])
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `SELECT hookline_ensure_request_partitions(current_date - 1, current_date + 1)`)
	require.NoError(t, err)
	return e
}

func (e *env) wsURL() string { return "ws" + strings.TrimPrefix(e.lb.URL, "http") + protocol.Path }

// forwardTo is a minimal CLI handler: send the request to the local server.
func (e *env) forwardTo() tunnel.Handler {
	return func(ctx context.Context, req protocol.Request) (*protocol.Response, *protocol.Error) {
		body, _ := base64.StdEncoding.DecodeString(req.BodyB64)
		target := e.local.URL + req.Path
		if req.Query != "" {
			target += "?" + req.Query
		}
		out, _ := http.NewRequestWithContext(ctx, req.Method, target, strings.NewReader(string(body)))
		for _, h := range req.Headers {
			if !strings.EqualFold(h[0], "Host") && !strings.EqualFold(h[0], "Content-Length") {
				out.Header.Add(h[0], h[1])
			}
		}
		resp, err := http.DefaultClient.Do(out)
		if err != nil {
			return nil, &protocol.Error{Code: protocol.CodeTargetUnreachable, Message: err.Error()}
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		var headers []protocol.Header
		for k, vs := range resp.Header {
			for _, v := range vs {
				headers = append(headers, protocol.Header{k, v})
			}
		}
		return &protocol.Response{Status: resp.StatusCode, Headers: headers, BodyB64: base64.StdEncoding.EncodeToString(data)}, nil
	}
}

type events struct {
	mu     sync.Mutex
	list   []tunnel.Event
	readyC chan *protocol.Ready
}

func (ev *events) on(e tunnel.Event) {
	ev.mu.Lock()
	ev.list = append(ev.list, e)
	ev.mu.Unlock()
	if e.Kind == tunnel.EventReady {
		ev.readyC <- e.Ready
	}
}

func (ev *events) has(kind tunnel.EventKind) bool {
	ev.mu.Lock()
	defer ev.mu.Unlock()
	for _, e := range ev.list {
		if e.Kind == kind {
			return true
		}
	}
	return false
}

// startCLI runs a tunnel client until the test ends and waits for it to be ready.
func (e *env) startCLI(sync bool, handler tunnel.Handler) (*tunnel.Client, *events, <-chan error) {
	e.t.Helper()
	ev := &events{readyC: make(chan *protocol.Ready, 16)}
	c := &tunnel.Client{
		URL: e.wsURL(), APIKey: apiKey, Endpoints: []string{slug}, Sync: sync, CLIVersion: "test",
		Handler: handler, OnEvent: ev.on,
		MinBackoff: 50 * time.Millisecond, MaxBackoff: 200 * time.Millisecond, PingInterval: 200 * time.Millisecond,
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- c.Run(ctx) }()
	e.t.Cleanup(func() {
		cancel()
		assert.NoError(e.t, <-done, "Run returns nil when cancelled")
	})
	select {
	case r := <-ev.readyC:
		require.Len(e.t, r.Endpoints, 1)
		assert.Equal(e.t, "https://hooks.example.test/h/"+slug, r.Endpoints[0].URL)
	case err := <-done:
		e.t.Fatalf("tunnel ended before ready: %v", err)
	case <-time.After(10 * time.Second):
		e.t.Fatal("tunnel never became ready")
	}
	return c, ev, done
}

func (e *env) send(path, body string) *http.Response {
	e.t.Helper()
	resp, err := http.Post(e.intake.URL+"/h/"+slug+path, "application/json", strings.NewReader(body))
	require.NoError(e.t, err)
	e.t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func (e *env) setSyncMode(timeoutMs int) {
	_, err := e.pool.Exec(e.t.Context(), `UPDATE endpoint SET response_mode = 'cli_sync', sync_timeout_ms = $2 WHERE id = $1`, e.endpoint, timeoutMs)
	require.NoError(e.t, err)
	e.mr.Del(endpoints.CacheKey(slug))
}

func eventually(t *testing.T, cond func() bool) {
	t.Helper()
	require.Eventually(t, cond, 10*time.Second, 20*time.Millisecond)
}

func TestForwardsAcrossInstances(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.startCLI(false, e.forwardTo())

	// Intake runs on instance A; the tunnel lives on instance B.
	resp := e.send("/stripe?x=1", `{"type":"payment_intent.succeeded"}`)
	assert.Equal(t, http.StatusOK, resp.StatusCode, "static response")
	eventually(t, func() bool { return e.local.count() == 1 })
	e.local.mu.Lock()
	got, body := e.local.received[0], e.local.bodies[0]
	e.local.mu.Unlock()
	assert.Equal(t, "/stripe", got.URL.Path)
	assert.Equal(t, "x=1", got.URL.RawQuery)
	assert.JSONEq(t, `{"type":"payment_intent.succeeded"}`, body)
	assert.Equal(t, "application/json", got.Header.Get("Content-Type"))
	assert.Equal(t, 1, e.b.tunnels.Sessions())
}

func TestSyncModeAnswersTheSender(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.setSyncMode(5000)
	e.startCLI(true, e.forwardTo())

	resp := e.send("/orders", `{"id":1}`)
	body, _ := io.ReadAll(resp.Body)
	assert.Equal(t, http.StatusCreated, resp.StatusCode)
	assert.JSONEq(t, `{"handled":"/orders"}`, string(body))
	assert.Equal(t, "yes", resp.Header.Get("X-Local"))
	assert.Contains(t, resp.Header.Get("Content-Security-Policy"), "sandbox", "the sandbox CSP stays")

	id := resp.Header.Get("X-Hookline-Request-Id")
	eventually(t, func() bool {
		var status int
		_ = e.pool.QueryRow(t.Context(), `SELECT response_status FROM request WHERE id = $1`, id).Scan(&status)
		return status == http.StatusCreated
	})
}

func TestSyncModeFallsBack(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.setSyncMode(1000) // the shortest timeout the schema allows

	start := time.Now()
	resp := e.send("/", `{}`)
	assert.Equal(t, http.StatusOK, resp.StatusCode, "no tunnel: static response")
	assert.Less(t, time.Since(start), 300*time.Millisecond, "without tunnels nobody is waited for")

	// An observing session (no --sync) does not answer.
	e.startCLI(false, e.forwardTo())
	start = time.Now()
	resp = e.send("/", `{}`)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.GreaterOrEqual(t, time.Since(start), 950*time.Millisecond, "waited for the deadline")

	// A failing local target answers with an error frame: static response at once.
	failing := func(context.Context, protocol.Request) (*protocol.Response, *protocol.Error) {
		return nil, &protocol.Error{Code: protocol.CodeTargetUnreachable, Message: "connection refused"}
	}
	e2 := newEnv(t)
	e2.setSyncMode(5000)
	e2.startCLI(true, failing)
	start = time.Now()
	resp = e2.send("/", `{}`)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Less(t, time.Since(start), 2*time.Second)
}

func TestReconnectsAfterGoAwayAndResumes(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	_, ev, _ := e.startCLI(false, e.forwardTo())
	e.send("/before", `{}`)
	eventually(t, func() bool { return e.local.count() == 1 })

	// Instance B restarts: the load balancer sends new connections to A.
	e.current.Store(e.a)
	e.b.tunnels.Shutdown()
	eventually(t, func() bool { return ev.has(tunnel.EventGoAway) })
	// Captured while the CLI is away; it must be replayed after reconnecting.
	e.send("/while-away", `{}`)

	select {
	case <-ev.readyC:
	case <-time.After(10 * time.Second):
		t.Fatal("did not reconnect")
	}
	eventually(t, func() bool { return e.local.count() >= 2 })
	e.send("/after", `{}`)
	eventually(t, func() bool { return e.local.count() == 3 })
	e.local.mu.Lock()
	paths := []string{e.local.received[0].URL.Path, e.local.received[1].URL.Path, e.local.received[2].URL.Path}
	e.local.mu.Unlock()
	assert.Equal(t, []string{"/before", "/while-away", "/after"}, paths, "each request exactly once, in order")
	assert.Equal(t, 1, e.a.tunnels.Sessions())
	assert.Equal(t, 0, e.b.tunnels.Sessions())
}

func TestRejectsBadKeysAndUnknownEndpoints(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	run := func(key string, eps []string) error {
		c := &tunnel.Client{URL: e.wsURL(), APIKey: key, Endpoints: eps, CLIVersion: "test", MinBackoff: 10 * time.Millisecond}
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
		defer cancel()
		return c.Run(ctx)
	}
	var fatal *tunnel.FatalError
	err := run("hk_live_wrongwrongwrongwrongwrongwrongwrongwrongwr", []string{slug})
	require.ErrorAs(t, err, &fatal)
	assert.Equal(t, http.StatusUnauthorized, fatal.Status)

	err = run(apiKey, []string{"doesNotExist"})
	require.ErrorAs(t, err, &fatal)
	assert.Equal(t, protocol.CodeUnknownEndpoint, fatal.Code)
	assert.Equal(t, protocol.CloseUnknownEndpoint, fatal.Close)
}

func TestKeyWithoutTunnelScopeIsForbidden(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	key := "hk_live_ReadOnlyKey0123456789abcdefghijABCDEFGHIJKL"
	sum := sha256.Sum256([]byte(key))
	_, err := e.pool.Exec(t.Context(), `INSERT INTO api_key (org_id, name, prefix, hash, scopes) VALUES ($1, 'r', 'hk_live_Read', $2, '{endpoints:read}')`, e.org, sum[:])
	require.NoError(t, err)
	c := &tunnel.Client{URL: e.wsURL(), APIKey: key, Endpoints: []string{slug}, CLIVersion: "test"}
	var fatal *tunnel.FatalError
	require.ErrorAs(t, c.Run(t.Context()), &fatal)
	assert.Equal(t, http.StatusForbidden, fatal.Status)
}

func TestPlanLimitsConcurrentTunnels(t *testing.T) {
	t.Parallel()
	e := newEnv(t) // free plan: one tunnel
	e.startCLI(false, nil)

	ev := make(chan tunnel.Event, 16)
	c := &tunnel.Client{
		URL: e.wsURL(), APIKey: apiKey, Endpoints: []string{slug}, CLIVersion: "test",
		MinBackoff: time.Second, OnEvent: func(x tunnel.Event) { ev <- x },
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go func() { _ = c.Run(ctx) }()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case x := <-ev:
			if x.Kind == tunnel.EventServerError {
				assert.Equal(t, protocol.CodeTooManyTunnels, x.Code)
				return
			}
			require.NotEqual(t, tunnel.EventReady, x.Kind, "a second tunnel must not open")
		case <-deadline:
			t.Fatal("no too_many_tunnels error")
		}
	}
}

// dialRaw opens a protocol-level connection for edge-case frames.
func (e *env) dialRaw(t *testing.T) *websocket.Conn {
	t.Helper()
	hdr := http.Header{"Authorization": {"Bearer " + apiKey}}
	conn, _, err := websocket.Dial(t.Context(), e.wsURL(), &websocket.DialOptions{HTTPHeader: hdr, Subprotocols: []string{protocol.Subprotocol}})
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.CloseNow() })
	conn.SetReadLimit(protocol.HardMessageBytes)
	return conn
}

func readFrame(t *testing.T, conn *websocket.Conn) (protocol.Type, []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	for {
		_, data, err := conn.Read(ctx)
		require.NoError(t, err)
		typ, _, err := protocol.Peek(data)
		require.NoError(t, err)
		if typ != protocol.TypePing {
			return typ, data
		}
	}
}

func write(t *testing.T, conn *websocket.Conn, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	require.NoError(t, conn.Write(t.Context(), websocket.MessageText, b))
}

func TestNewerProtocolGetsAnUpgradeMessage(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	conn := e.dialRaw(t)
	write(t, conn, protocol.Hello{Type: protocol.TypeHello, Protocol: 2, Endpoints: []string{slug}})
	typ, data := readFrame(t, conn)
	require.Equal(t, protocol.TypeError, typ)
	var perr protocol.Error
	require.NoError(t, json.Unmarshal(data, &perr))
	assert.Equal(t, protocol.CodeUnsupportedProtocol, perr.Code)
	assert.Contains(t, perr.Message, "protocol 1")
	_, _, err := conn.Read(t.Context())
	assert.Equal(t, websocket.StatusCode(protocol.CloseUnsupportedProtocol), websocket.CloseStatus(err))
}

func TestOversizedFramesGetAnErrorFrame(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	conn := e.dialRaw(t)
	write(t, conn, protocol.Hello{Type: protocol.TypeHello, Protocol: 1, Endpoints: []string{slug}, Sync: true})
	typ, _ := readFrame(t, conn)
	require.Equal(t, protocol.TypeReady, typ)

	big := protocol.Response{Type: protocol.TypeResponse, ID: uuid.NewString(), Status: 200, BodyB64: strings.Repeat("A", protocol.MaxMessageBytes)}
	write(t, conn, big)
	typ, data := readFrame(t, conn)
	require.Equal(t, protocol.TypeError, typ)
	assert.Contains(t, string(data), protocol.CodeMessageTooLarge)

	// The session stays usable; unknown frame types are ignored.
	write(t, conn, map[string]any{"type": "from_the_future", "x": 1})
	write(t, conn, protocol.Ping{Type: protocol.TypePing})
	typ, _ = readFrame(t, conn)
	assert.Equal(t, protocol.TypePong, typ)
}

func TestPresenceIsAnnouncedToDashboards(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	rdb := redis.NewClient(&redis.Options{Addr: e.mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	sub := rdb.Subscribe(t.Context(), "ep:"+e.endpoint.String())
	t.Cleanup(func() { _ = sub.Close() })
	_, err := sub.Receive(t.Context())
	require.NoError(t, err)

	e.startCLI(false, nil)
	msg, err := sub.ReceiveMessage(t.Context())
	require.NoError(t, err)
	assert.JSONEq(t, `{"type":"tunnels","payload":{"endpoint_id":"`+e.endpoint.String()+`","count":1}}`, msg.Payload)
	n, err := rdb.ZCard(t.Context(), edgetunnel.EndpointKey(e.endpoint)).Result()
	require.NoError(t, err)
	assert.EqualValues(t, 1, n)
}
