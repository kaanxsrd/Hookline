package deliver_test

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbtest"
	"github.com/kaanxsrd/hookline/packages/gocommon/jobs"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/packages/gocommon/safehttp"
	"github.com/kaanxsrd/hookline/packages/gocommon/secretbox"
	"github.com/kaanxsrd/hookline/services/worker/internal/deliver"
)

func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }

const encKey = "k1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

type events struct {
	mu   sync.Mutex
	list []deliver.Event
}

func (e *events) PublishDelivery(_ context.Context, _ uuid.UUID, ev deliver.Event) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.list = append(e.list, ev)
	return nil
}

type env struct {
	t        *testing.T
	pool     *pgxpool.Pool
	worker   *deliver.Worker
	blobs    *blob.Memory
	events   *events
	box      *secretbox.Box
	endpoint uuid.UUID
	now      time.Time
}

func newEnv(t *testing.T, allowPrivate bool) *env {
	t.Helper()
	pool := dbtest.New(t)
	box, err := secretbox.Parse(encKey)
	require.NoError(t, err)
	e := &env{t: t, pool: pool, blobs: blob.NewMemory(), events: &events{}, box: box, now: time.Now()}
	e.worker = &deliver.Worker{
		Queries:   dbq.New(pool),
		Blobs:     e.blobs,
		HTTP:      safehttp.NewClient(safehttp.Options{AllowPrivate: allowPrivate}),
		Secrets:   box,
		Publisher: e.events,
		Logger:    logging.Discard(),
		Now:       func() time.Time { return e.now },
		Rand:      func() float64 { return 0.5 },
	}
	require.NoError(t, pool.QueryRow(t.Context(), `
		INSERT INTO endpoint (slug, name, expires_at) VALUES ('workerSlug01', 'x', now() + interval '1 day') RETURNING id`,
	).Scan(&e.endpoint))
	return e
}

type requestOpts struct {
	method, path, query, headers string
	body                         []byte
	s3Key                        string
}

// delivery inserts a request, a destination (signing with signingSecret when
// set) and a pending delivery.
func (e *env) delivery(url string, maxAttempts int, req requestOpts, signingSecret string) uuid.UUID {
	e.t.Helper()
	ctx := e.t.Context()
	if req.method == "" {
		req.method = "POST"
	}
	if req.path == "" {
		req.path = "/"
	}
	if req.query == "" {
		req.query = "[]"
	}
	if req.headers == "" {
		req.headers = `[["Host","edge.example"],["Content-Type","application/json"],["X-Custom","yes"],["Connection","close, X-Drop"],["X-Drop","1"],["X-Forwarded-For","1.2.3.4"]]`
	}
	var key *string
	var inline []byte
	if req.s3Key != "" {
		key = &req.s3Key
	} else {
		inline = req.body
	}
	var requestID uuid.UUID
	var receivedAt time.Time
	require.NoError(e.t, e.pool.QueryRow(ctx, `
		INSERT INTO request (endpoint_id, method, path, query, headers, content_type, body_inline, body_s3_key, body_size)
		VALUES ($1, $2, $3, $4, $5, 'application/json', $6, $7, $8) RETURNING id, received_at`,
		e.endpoint, req.method, req.path, req.query, req.headers, inline, key, len(req.body)).Scan(&requestID, &receivedAt))

	destID := uuid.Must(uuid.NewV7())
	var sealed *string
	if signingSecret != "" {
		enc, err := e.box.Seal(signingSecret, deliver.SigningContext(destID))
		require.NoError(e.t, err)
		sealed = &enc
	}
	_, err := e.pool.Exec(ctx, `
		INSERT INTO destination (id, endpoint_id, name, url, max_attempts, timeout_ms, extra_headers, sign_with_standard_webhooks, signing_secret_enc)
		VALUES ($1, $2, 'dest', $3, $4, 2000, '[["X-Extra","1"]]', $5, $6)`,
		destID, e.endpoint, url, maxAttempts, sealed != nil, sealed)
	require.NoError(e.t, err)

	var id uuid.UUID
	require.NoError(e.t, e.pool.QueryRow(ctx, `
		INSERT INTO delivery (request_id, request_received_at, destination_id, endpoint_id)
		VALUES ($1, $2, $3, $4) RETURNING id`, requestID, receivedAt, destID, e.endpoint).Scan(&id))
	return id
}

func (e *env) work(id uuid.UUID) error {
	return e.worker.Work(e.t.Context(), &river.Job[jobs.DeliverArgs]{Args: jobs.DeliverArgs{DeliveryID: id}})
}

type state struct {
	status   string
	attempts int
	code     *int32
	next     *time.Time
}

func (e *env) state(id uuid.UUID) state {
	var s state
	require.NoError(e.t, e.pool.QueryRow(e.t.Context(),
		`SELECT status, attempt_count, last_status_code, next_attempt_at FROM delivery WHERE id = $1`, id,
	).Scan(&s.status, &s.attempts, &s.code, &s.next))
	return s
}

func (e *env) attempts(id uuid.UUID) (codes []*int32, errs []*string) {
	rows, err := e.pool.Query(e.t.Context(), `SELECT status_code, error FROM delivery_attempt WHERE delivery_id = $1 ORDER BY attempt_no`, id)
	require.NoError(e.t, err)
	defer rows.Close()
	for rows.Next() {
		var c *int32
		var msg *string
		require.NoError(e.t, rows.Scan(&c, &msg))
		codes = append(codes, c)
		errs = append(errs, msg)
	}
	return codes, errs
}

func TestForwardsFaithfully(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	var got *http.Request
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Clone(context.WithoutCancel(r.Context()))
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("X-Reply", "ok")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer srv.Close()

	id := e.delivery(srv.URL+"/hooks?dest=1", 3, requestOpts{
		method: "PUT", path: "/stripe/events", query: `[["a","1"],["a","2"]]`, body: []byte(`{"x":1}`),
	}, "")
	require.NoError(t, e.work(id))

	require.NotNil(t, got)
	assert.Equal(t, "PUT", got.Method)
	assert.Equal(t, "/hooks/stripe/events", got.URL.Path)
	assert.Equal(t, []string{"1", "2"}, got.URL.Query()["a"])
	assert.Equal(t, "1", got.URL.Query().Get("dest"))
	assert.JSONEq(t, `{"x":1}`, string(gotBody))
	assert.Equal(t, "yes", got.Header.Get("X-Custom"))
	assert.Equal(t, "1", got.Header.Get("X-Extra"))
	assert.Equal(t, "application/json", got.Header.Get("Content-Type"))
	assert.Empty(t, got.Header.Get("X-Drop"), "connection-scoped headers are dropped")
	assert.Empty(t, got.Header.Get("X-Forwarded-For"))
	assert.NotEqual(t, "edge.example", got.Host)
	assert.Equal(t, id.String(), got.Header.Get("X-Hookline-Delivery-Id"))
	assert.Equal(t, "1", got.Header.Get("X-Hookline-Attempt"))
	assert.Equal(t, "workerSlug01", got.Header.Get("X-Hookline-Endpoint"))

	s := e.state(id)
	assert.Equal(t, "succeeded", s.status)
	assert.Equal(t, 1, s.attempts)
	require.NotNil(t, s.code)
	assert.Equal(t, int32(200), *s.code)

	var respBody []byte
	var respHeaders string
	require.NoError(t, e.pool.QueryRow(t.Context(),
		`SELECT response_body, response_headers::text FROM delivery_attempt WHERE delivery_id = $1`, id).Scan(&respBody, &respHeaders))
	assert.JSONEq(t, `{"ok":true}`, string(respBody))
	assert.Contains(t, respHeaders, `"X-Reply", "ok"`)

	require.Len(t, e.events.list, 1)
	assert.Equal(t, "succeeded", e.events.list[0].Status)
	assert.Equal(t, []string{"succeeded"}, e.events.list[0].Statuses)
}

func TestBodiesFromObjectStorage(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	big := make([]byte, 100<<10)
	for i := range big {
		big[i] = 'a' + byte(i%26)
	}
	require.NoError(t, e.blobs.Put(t.Context(), "k/big", big, ""))
	var n int
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		n = len(b)
	}))
	defer srv.Close()
	id := e.delivery(srv.URL, 3, requestOpts{body: big, s3Key: "k/big"}, "")
	require.NoError(t, e.work(id))
	assert.Equal(t, len(big), n)
}

func TestRetriesThenGivesUp(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	id := e.delivery(srv.URL, 3, requestOpts{body: []byte(`{}`)}, "")

	for attempt := 1; attempt <= 2; attempt++ {
		err := e.work(id)
		var snooze *river.JobSnoozeError
		require.ErrorAs(t, err, &snooze, "attempt %d is retried", attempt)
		// Full jitter with rand=0.5: half of 10s·2^(n-1).
		assert.Equal(t, 5*time.Second*time.Duration(1<<(attempt-1)), snooze.Duration)
		s := e.state(id)
		assert.Equal(t, "pending", s.status)
		assert.Equal(t, attempt, s.attempts)
		require.NotNil(t, s.next)
	}
	require.NoError(t, e.work(id), "the last attempt completes the job")
	s := e.state(id)
	assert.Equal(t, "failed", s.status)
	assert.Equal(t, 3, s.attempts)
	assert.Equal(t, 3, calls)
	codes, _ := e.attempts(id)
	assert.Len(t, codes, 3)
}

func TestRetryAfterIsRespected(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	id := e.delivery(srv.URL, 5, requestOpts{body: []byte(`{}`)}, "")
	var snooze *river.JobSnoozeError
	require.ErrorAs(t, e.work(id), &snooze)
	assert.Equal(t, 2*time.Minute, snooze.Duration)
}

func TestClientErrorsFailImmediately(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	id := e.delivery(srv.URL, 8, requestOpts{body: []byte(`{}`)}, "")
	require.NoError(t, e.work(id))
	s := e.state(id)
	assert.Equal(t, "failed", s.status)
	assert.Equal(t, 1, s.attempts)
}

func TestPrivateDestinationsAreBlocked(t *testing.T) {
	t.Parallel()
	e := newEnv(t, false)
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	defer srv.Close()
	id := e.delivery(srv.URL, 8, requestOpts{body: []byte(`{}`)}, "")
	require.NoError(t, e.work(id), "blocked addresses fail permanently")
	assert.False(t, hit)
	s := e.state(id)
	assert.Equal(t, "failed", s.status)
	_, errs := e.attempts(id)
	require.Len(t, errs, 1)
	require.NotNil(t, errs[0])
	assert.Contains(t, *errs[0], "not allowed")
}

func TestUnreachableIsRetried(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close() // nothing listens any more
	id := e.delivery(url, 3, requestOpts{body: []byte(`{}`)}, "")
	var snooze *river.JobSnoozeError
	require.ErrorAs(t, e.work(id), &snooze)
	_, errs := e.attempts(id)
	require.NotNil(t, errs[0])
	assert.Equal(t, "connection refused", *errs[0])
}

func TestDisabledDestinationCancelsAutomaticDeliveries(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	id := e.delivery("https://example.com", 3, requestOpts{body: []byte(`{}`)}, "")
	_, err := e.pool.Exec(t.Context(), `UPDATE destination SET enabled = false`)
	require.NoError(t, err)
	require.NoError(t, e.work(id))
	assert.Equal(t, "cancelled", e.state(id).status)
	require.NoError(t, e.work(id), "final deliveries are left alone")
}

func TestStandardWebhooksSignature(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	secret := "whsec_" + base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	var headers http.Header
	var body []byte
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		headers = r.Header.Clone()
		body, _ = io.ReadAll(r.Body)
	}))
	defer srv.Close()

	id := e.delivery(srv.URL, 3, requestOpts{body: []byte(`{"signed":true}`)}, secret)
	require.NoError(t, e.work(id))
	ts, err := time.Parse(time.RFC3339, e.now.UTC().Format(time.RFC3339))
	require.NoError(t, err)
	want, err := deliver.StandardWebhooksSignature(secret, headers.Get("webhook-id"), ts, body)
	require.NoError(t, err)
	assert.Equal(t, want, headers.Get("webhook-signature"))
	assert.NotEmpty(t, headers.Get("webhook-timestamp"))
}

func TestStandardWebhooksKnownVector(t *testing.T) {
	// Example from the Standard Webhooks specification.
	sig, err := deliver.StandardWebhooksSignature(
		"whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
		"msg_p5jXN8AQM9LWM0D4loKWxJek",
		time.Unix(1614265330, 0),
		[]byte(`{"test": 2432232314}`),
	)
	require.NoError(t, err)
	assert.Equal(t, "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=", sig)
}

func TestMissingDeliveryIsIgnored(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	require.NoError(t, e.work(uuid.New()))
}

func TestEditedReplaySendsTheOverride(t *testing.T) {
	t.Parallel()
	e := newEnv(t, true)
	var got *http.Request
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Clone(context.WithoutCancel(r.Context()))
		gotBody, _ = io.ReadAll(r.Body)
	}))
	defer srv.Close()

	id := e.delivery(srv.URL, 3, requestOpts{method: "POST", path: "/original", body: []byte(`{"amount":1}`)}, "")
	_, err := e.pool.Exec(t.Context(), `
		INSERT INTO delivery_override (delivery_id, method, path, query, headers, body)
		VALUES ($1, 'PATCH', '/edited', '[["v","2"]]', '[["Content-Type","text/plain"],["X-Edited","yes"]]', 'edited body')`, id)
	require.NoError(t, err)
	require.NoError(t, e.work(id))

	require.NotNil(t, got)
	assert.Equal(t, "PATCH", got.Method)
	assert.Equal(t, "/edited", got.URL.Path)
	assert.Equal(t, "v=2", got.URL.RawQuery)
	assert.Equal(t, "text/plain", got.Header.Get("Content-Type"))
	assert.Equal(t, "yes", got.Header.Get("X-Edited"))
	assert.Equal(t, "edited body", string(gotBody))

	var method string
	var body []byte
	require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT method, body_inline FROM request LIMIT 1`).Scan(&method, &body))
	assert.Equal(t, "POST", method, "the captured request is untouched")
	assert.JSONEq(t, `{"amount":1}`, string(body))
}
