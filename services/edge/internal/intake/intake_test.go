package intake_test

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/redis/go-redis/v9"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/clientip"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbtest"
	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/services/edge/internal/counters"
	"github.com/kaanxsrd/hookline/services/edge/internal/endpoints"
	"github.com/kaanxsrd/hookline/services/edge/internal/intake"
	"github.com/kaanxsrd/hookline/services/edge/internal/live"
	"github.com/kaanxsrd/hookline/services/edge/internal/metrics"
	"github.com/kaanxsrd/hookline/services/edge/internal/ratelimit"
	"github.com/kaanxsrd/hookline/services/edge/internal/server"
)

func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }

type env struct {
	t        *testing.T
	pool     *pgxpool.Pool
	mr       *miniredis.Miniredis
	rdb      *redis.Client
	blobs    *blob.Memory
	counters *counters.Counters
	metrics  *metrics.Metrics
	handler  http.Handler
	orgID    uuid.UUID
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pool := dbtest.New(t)
	q := dbq.New(pool)
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = rdb.Close() })

	trusted, err := clientip.ParseTrusted(clientip.DefaultTrusted)
	require.NoError(t, err)
	e := &env{t: t, pool: pool, mr: mr, rdb: rdb, blobs: blob.NewMemory(), metrics: metrics.New()}
	e.counters = counters.New(q, logging.Discard(), time.Hour)
	jobClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	require.NoError(t, err)
	h := intake.New(intake.Deps{
		Pool:      pool,
		Jobs:      jobClient,
		Queries:   q,
		Endpoints: endpoints.NewCache(q, rdb, "", logging.Discard()),
		Limiter:   ratelimit.New(rdb, ratelimit.Rule{Rate: 1000, Burst: 1000}),
		Blobs:     e.blobs,
		Publisher: live.NewPublisher(rdb),
		Counters:  e.counters,
		IPs:       clientip.New(trusted),
		Metrics:   e.metrics,
		Logger:    logging.Discard(),
	})
	e.handler = server.New(logging.Discard(), server.Routes{Intake: h})

	require.NoError(t, pool.QueryRow(t.Context(),
		`INSERT INTO organization (name, slug) VALUES ('Acme', 'acme') RETURNING id`).Scan(&e.orgID))
	return e
}

type endpointOpts struct {
	slug      string
	plan      string // "" = no subscription row (free)
	anonymous bool
	status    string
	expiresAt *time.Time
	respond   string // response_headers JSON
	body      string
	code      int
	delayMs   int
}

func (e *env) endpoint(o endpointOpts) uuid.UUID {
	e.t.Helper()
	ctx := e.t.Context()
	if o.slug == "" {
		o.slug = "abcdefABCDEF"
	}
	if o.status == "" {
		o.status = "active"
	}
	if o.respond == "" {
		o.respond = "[]"
	}
	if o.code == 0 {
		o.code = 200
	}
	var org *uuid.UUID
	if !o.anonymous {
		org = &e.orgID
	}
	expires := o.expiresAt
	if o.anonymous && expires == nil {
		t := time.Now().Add(24 * time.Hour)
		expires = &t
	}
	var id uuid.UUID
	require.NoError(e.t, e.pool.QueryRow(ctx, `
		INSERT INTO endpoint (org_id, slug, name, status, response_headers, response_body, response_status, response_delay_ms, expires_at)
		VALUES ($1, $2, 'test', $3, $4, $5, $6, $7, $8) RETURNING id`,
		org, o.slug, o.status, o.respond, o.body, o.code, o.delayMs, expires).Scan(&id))
	if o.plan != "" {
		_, err := e.pool.Exec(ctx, `INSERT INTO subscription (org_id, plan) VALUES ($1, $2)
			ON CONFLICT (org_id) DO UPDATE SET plan = EXCLUDED.plan`, e.orgID, o.plan)
		require.NoError(e.t, err)
	}
	return id
}

func (e *env) send(method, target string, body io.Reader, header map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	r := httptest.NewRequest(method, target, body)
	r.RemoteAddr = "203.0.113.50:40000"
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.handler.ServeHTTP(w, r)
	return w
}

func (e *env) count(endpointID uuid.UUID) int {
	e.t.Helper()
	var n int
	require.NoError(e.t, e.pool.QueryRow(e.t.Context(), `SELECT count(*) FROM request WHERE endpoint_id = $1`, endpointID).Scan(&n))
	return n
}

func errorCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body httpx.ErrorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body), w.Body.String())
	return body.Error.Code
}

func TestCapturesRequest(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	epID := e.endpoint(endpointOpts{
		respond: `[["Content-Type","application/json"],["X-Custom","yes"]]`,
		body:    `{"received":true}`,
		code:    202,
	})
	sub := e.rdb.Subscribe(t.Context(), live.Channel(epID))
	defer sub.Close()
	_, err := sub.Receive(t.Context())
	require.NoError(t, err)

	w := e.send("POST", "/h/abcdefABCDEF/stripe/events?b=2&a=1&a=&b=x%20y", strings.NewReader(`{"a":1}`), map[string]string{
		"Content-Type":     "application/json",
		"User-Agent":       "Stripe/1.0",
		"Stripe-Signature": "t=1,v1=abc",
	})

	require.Equal(t, http.StatusAccepted, w.Code, w.Body.String())
	assert.JSONEq(t, `{"received":true}`, w.Body.String())
	assert.Equal(t, "yes", w.Header().Get("X-Custom"))
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, w.Header().Get("Content-Security-Policy"), "sandbox")
	assert.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
	reqID := uuid.MustParse(w.Header().Get(httpx.RequestIDHeader))

	var (
		method, path, ct, ua string
		query, headers       json.RawMessage
		body, sha            []byte
		size                 int
		ip                   string
		status               int
	)
	require.NoError(t, e.pool.QueryRow(t.Context(), `
		SELECT method, path, query, headers, content_type, body_inline, body_size, body_sha256,
		       host(source_ip), user_agent, response_status
		FROM request WHERE id = $1`, reqID).Scan(&method, &path, &query, &headers, &ct, &body, &size, &sha, &ip, &ua, &status))
	assert.Equal(t, "POST", method)
	assert.Equal(t, "/stripe/events", path)
	assert.JSONEq(t, `[["b","2"],["a","1"],["a",""],["b","x y"]]`, string(query), "query keeps order, repeats and empties")
	var pairs [][2]string
	require.NoError(t, json.Unmarshal(headers, &pairs))
	assert.Contains(t, pairs, [2]string{"Stripe-Signature", "t=1,v1=abc"})
	assert.Equal(t, [2]string{"Host", "example.com"}, pairs[0], "Host comes first")
	assert.Equal(t, "application/json", ct)
	assert.JSONEq(t, `{"a":1}`, string(body))
	assert.Equal(t, 7, size)
	assert.Len(t, sha, 32)
	assert.Equal(t, "203.0.113.50", ip)
	assert.Equal(t, "Stripe/1.0", ua)
	assert.Equal(t, 202, status)

	msg, err := sub.ReceiveMessage(t.Context())
	require.NoError(t, err)
	var ev live.Event
	require.NoError(t, json.Unmarshal([]byte(msg.Payload), &ev))
	assert.Equal(t, "request", ev.Type)
	var summary live.RequestSummary
	require.NoError(t, json.Unmarshal(ev.Payload, &summary))
	assert.Equal(t, reqID, summary.ID)
	assert.Equal(t, "/stripe/events", summary.Path)
	assert.NotContains(t, msg.Payload, "abc", "summaries never carry header values")

	e.counters.Flush(t.Context())
	var n int64
	require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT request_count FROM endpoint WHERE id = $1`, epID).Scan(&n))
	assert.Equal(t, int64(1), n)
}

func TestMethodsAndPaths(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	epID := e.endpoint(endpointOpts{body: "ok"})

	for _, tc := range []struct{ method, target, wantPath string }{
		{"GET", "/h/abcdefABCDEF", "/"},
		{"PUT", "/h/abcdefABCDEF/", "/"},
		{"DELETE", "/h/abcdefABCDEF/a/b%2Fc", "/a/b%2Fc"},
		{"PATCH", "/h/abcdefABCDEF/x", "/x"},
		{"OPTIONS", "/h/abcdefABCDEF", "/"},
	} {
		w := e.send(tc.method, tc.target, nil, nil)
		require.Equal(t, http.StatusOK, w.Code, tc.method)
		var path string
		require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT path FROM request WHERE id = $1`,
			uuid.MustParse(w.Header().Get(httpx.RequestIDHeader))).Scan(&path))
		assert.Equal(t, tc.wantPath, path, tc.method)
	}

	head := e.send("HEAD", "/h/abcdefABCDEF", nil, nil)
	assert.Equal(t, http.StatusOK, head.Code)
	assert.Equal(t, 6, e.count(epID), "HEAD is captured too")
}

func TestPreflightIsAnsweredNotCaptured(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	epID := e.endpoint(endpointOpts{})
	w := e.send("OPTIONS", "/h/abcdefABCDEF", nil, map[string]string{
		"Origin":                         "https://app.example.com",
		"Access-Control-Request-Method":  "POST",
		"Access-Control-Request-Headers": "content-type,x-signature",
	})
	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "content-type,x-signature", w.Header().Get("Access-Control-Allow-Headers"))
	assert.Zero(t, e.count(epID))
}

func TestRejections(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	past := time.Now().Add(-time.Minute)
	e.endpoint(endpointOpts{slug: "pausedPaused"[:12], status: "paused"})
	e.endpoint(endpointOpts{slug: "disabled1234", status: "disabled_by_admin"})
	e.endpoint(endpointOpts{slug: "expired12345", anonymous: true, expiresAt: &past})

	for _, tc := range []struct {
		target, code string
		status       int
	}{
		{"/h/doesNotExist", "not_found", 404},
		{"/h/short", "not_found", 404},
		{"/h/bad-chars!!!", "not_found", 404},
		{"/h/unknown12345", "not_found", 404},
		{"/h/pausedPaused", "endpoint_paused", 410},
		{"/h/disabled1234/x", "endpoint_disabled", 410},
		{"/h/expired12345", "endpoint_expired", 410},
	} {
		w := e.send("POST", tc.target, strings.NewReader("{}"), nil)
		assert.Equal(t, tc.status, w.Code, tc.target)
		assert.Equal(t, tc.code, errorCode(t, w), tc.target)
		assert.NotEmpty(t, w.Header().Get(httpx.RequestIDHeader), "rejections carry a request ID too")
		assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	}
	var n int
	require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT count(*) FROM request`).Scan(&n))
	assert.Zero(t, n)
	assert.InDelta(t, 4, testutil.ToFloat64(e.metrics.IntakeRejects.WithLabelValues("not_found")), 0)
}

func TestBodyLimits(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	freeID := e.endpoint(endpointOpts{}) // free plan: 256 KiB
	limit := 256 << 10

	ok := e.send("POST", "/h/abcdefABCDEF", strings.NewReader(strings.Repeat("a", limit)), nil)
	assert.Equal(t, http.StatusOK, ok.Code, "exactly at the limit is accepted")

	declared := e.send("POST", "/h/abcdefABCDEF", strings.NewReader(strings.Repeat("a", limit+1)), nil)
	assert.Equal(t, http.StatusRequestEntityTooLarge, declared.Code)
	assert.Equal(t, "body_too_large", errorCode(t, declared))

	// No Content-Length: the limit is enforced while streaming.
	r := httptest.NewRequest(http.MethodPost, "/h/abcdefABCDEF", io.MultiReader(strings.NewReader(strings.Repeat("b", limit)), strings.NewReader("overflow")))
	r.ContentLength = -1
	w := httptest.NewRecorder()
	e.handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)

	assert.Equal(t, 1, e.count(freeID), "rejected bodies are not stored")
}

func TestLargeBodiesGoToObjectStorage(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.endpoint(endpointOpts{plan: "pro"}) // pro: 5 MiB
	big := strings.Repeat("x", 100<<10)

	w := e.send("POST", "/h/abcdefABCDEF", strings.NewReader(big), map[string]string{"Content-Type": "text/plain"})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var (
		inline []byte
		key    *string
		size   int
	)
	require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT body_inline, body_s3_key, body_size FROM request WHERE id = $1`,
		uuid.MustParse(w.Header().Get(httpx.RequestIDHeader))).Scan(&inline, &key, &size))
	assert.Nil(t, inline)
	require.NotNil(t, key)
	assert.Contains(t, *key, e.orgID.String()+"/")
	assert.Equal(t, 100<<10, size)
	rc, err := e.blobs.Get(t.Context(), *key)
	require.NoError(t, err)
	stored, _ := io.ReadAll(rc)
	assert.Equal(t, big, string(stored))

	// Object storage down: large bodies are refused, small ones still work.
	e.blobs.Fail = errors.New("s3 down")
	down := e.send("POST", "/h/abcdefABCDEF", strings.NewReader(big), nil)
	assert.Equal(t, http.StatusServiceUnavailable, down.Code)
	assert.Equal(t, "storage_unavailable", errorCode(t, down))
	small := e.send("POST", "/h/abcdefABCDEF", strings.NewReader("small"), nil)
	assert.Equal(t, http.StatusOK, small.Code)
}

func TestRateLimit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.endpoint(endpointOpts{anonymous: true}) // anonymous: 2/s, burst 20

	var last *httptest.ResponseRecorder
	for range 21 {
		last = e.send("POST", "/h/abcdefABCDEF", strings.NewReader("{}"), nil)
	}
	assert.Equal(t, http.StatusTooManyRequests, last.Code)
	assert.Equal(t, "rate_limited", errorCode(t, last))
	assert.NotEmpty(t, last.Header().Get("Retry-After"))
}

func TestRedisOutageFailsOpen(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	epID := e.endpoint(endpointOpts{body: "ok"})
	e.mr.Close()

	for range 3 {
		w := e.send("POST", "/h/abcdefABCDEF", strings.NewReader("{}"), nil)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	}
	assert.Equal(t, 3, e.count(epID), "intake keeps capturing without Redis")
	assert.Positive(t, testutil.ToFloat64(e.metrics.Degraded.WithLabelValues("redis", "rate_limit")))
}

func TestAnonymousQuota(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	epID := e.endpoint(endpointOpts{anonymous: true})
	_, err := e.pool.Exec(t.Context(), `
		INSERT INTO request (endpoint_id, method, path) SELECT $1, 'POST', '/' FROM generate_series(1, 100)`, epID)
	require.NoError(t, err)

	w := e.send("POST", "/h/abcdefABCDEF", strings.NewReader("{}"), nil)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.Equal(t, "quota_exceeded", errorCode(t, w))
	assert.Contains(t, w.Body.String(), "maximum of 100 requests")
}

func TestCustomResponseIsSanitized(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.endpoint(endpointOpts{
		respond: `[["Set-Cookie","session=evil; Path=/"],["Content-Type","text/html"],["Access-Control-Allow-Origin","https://evil.example"],["X-Hookline-Request-Id","spoof"],["Bad Name","x"],["X-Ok","fine"]]`,
		body:    "<script>alert(1)</script>",
		code:    201,
	})
	w := e.send("POST", "/h/abcdefABCDEF", nil, nil)
	assert.Equal(t, 201, w.Code)
	assert.Empty(t, w.Header().Values("Set-Cookie"))
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	assert.NotEqual(t, "spoof", w.Header().Get(httpx.RequestIDHeader))
	assert.Equal(t, "fine", w.Header().Get("X-Ok"))
	assert.Equal(t, "text/html", w.Header().Get("Content-Type"))
	assert.Equal(t, "sandbox; default-src 'none'; frame-ancestors 'none'", w.Header().Get("Content-Security-Policy"),
		"HTML responses run in an opaque, script-less sandbox")
}

func TestResponseDelay(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.endpoint(endpointOpts{delayMs: 150})
	start := time.Now()
	w := e.send("POST", "/h/abcdefABCDEF", nil, nil)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.GreaterOrEqual(t, time.Since(start), 150*time.Millisecond)
}

func TestMissingPartitionIsCreated(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	epID := e.endpoint(endpointOpts{})
	today := time.Now().UTC().Format("20060102")
	_, err := e.pool.Exec(t.Context(), "DROP TABLE request_p"+today)
	require.NoError(t, err)

	w := e.send("POST", "/h/abcdefABCDEF", strings.NewReader("{}"), nil)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, 1, e.count(epID))
}

func TestEndpointCacheServesFromRedis(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.endpoint(endpointOpts{body: "first"})
	require.Equal(t, "first", e.send("POST", "/h/abcdefABCDEF", nil, nil).Body.String())
	assert.True(t, e.mr.Exists(endpoints.CacheKey("abcdefABCDEF")))

	_, err := e.pool.Exec(t.Context(), `UPDATE endpoint SET response_body = 'second'`)
	require.NoError(t, err)
	assert.Equal(t, "first", e.send("POST", "/h/abcdefABCDEF", nil, nil).Body.String(), "served from cache")

	e.mr.Del(endpoints.CacheKey("abcdefABCDEF")) // what the web app does on update
	assert.Equal(t, "second", e.send("POST", "/h/abcdefABCDEF", nil, nil).Body.String())

	e.send("POST", "/h/unknown12345", nil, nil)
	val, err := e.mr.Get(endpoints.CacheKey("unknown12345"))
	require.NoError(t, err)
	assert.Equal(t, "-", val, "misses are cached briefly")
}

func TestMatchingDestinationsGetDeliveriesAndJobs(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	epID := e.endpoint(endpointOpts{})
	_, err := e.pool.Exec(t.Context(), `
		INSERT INTO destination (endpoint_id, name, url, filter, enabled) VALUES
		  ($1, 'all', 'https://example.com/a', '{}', true),
		  ($1, 'only GET', 'https://example.com/b', '{"methods":["GET"]}', true),
		  ($1, 'paid only', 'https://example.com/c', '{"json_path_equals":{"type":"order.paid"}}', true),
		  ($1, 'disabled', 'https://example.com/d', '{}', false)`, epID)
	require.NoError(t, err)

	w := e.send(http.MethodPost, "/h/abcdefABCDEF", strings.NewReader(`{"type":"order.paid"}`), nil)
	require.Equal(t, http.StatusOK, w.Code)
	reqID := uuid.MustParse(w.Header().Get(httpx.RequestIDHeader))

	rows, err := e.pool.Query(t.Context(), `
		SELECT dst.name, d.status, d.trigger FROM delivery d JOIN destination dst ON dst.id = d.destination_id
		WHERE d.request_id = $1 ORDER BY dst.name`, reqID)
	require.NoError(t, err)
	var got []string
	for rows.Next() {
		var name, status, trigger string
		require.NoError(t, rows.Scan(&name, &status, &trigger))
		got = append(got, name+":"+status+":"+trigger)
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, []string{"all:pending:auto", "paid only:pending:auto"}, got)

	var jobs int
	require.NoError(t, e.pool.QueryRow(t.Context(), `
		SELECT count(*) FROM river_job WHERE kind = 'deliver' AND queue = 'deliveries'
		  AND (args->>'delivery_id')::uuid IN (SELECT id FROM delivery WHERE request_id = $1)`, reqID).Scan(&jobs))
	assert.Equal(t, 2, jobs, "one job per delivery, inserted in the intake transaction")
}
