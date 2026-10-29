package maintenance

import (
	"os"
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
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
)

func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }

type env struct {
	t     *testing.T
	pool  *pgxpool.Pool
	blobs *blob.Memory
	d     *Deps
	org   uuid.UUID
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pool := dbtest.New(t)
	e := &env{t: t, pool: pool, blobs: blob.NewMemory()}
	e.d = &Deps{Queries: dbq.New(pool), Blobs: e.blobs, Logger: logging.Discard(), Now: time.Now}
	require.NoError(t, pool.QueryRow(t.Context(), `INSERT INTO organization (name, slug) VALUES ('o', 'org') RETURNING id`).Scan(&e.org))
	_, err := pool.Exec(t.Context(), `SELECT hookline_ensure_request_partitions((now() - interval '40 days')::date, (now() + interval '1 day')::date)`)
	require.NoError(t, err)
	return e
}

func (e *env) endpoint(slug string, retentionHours int) uuid.UUID {
	var id uuid.UUID
	require.NoError(e.t, e.pool.QueryRow(e.t.Context(),
		`INSERT INTO endpoint (org_id, slug, name, retention_hours) VALUES ($1, $2, 'x', $3) RETURNING id`,
		e.org, slug, retentionHours).Scan(&id))
	return id
}

func (e *env) request(endpoint uuid.UUID, age time.Duration, s3Key string) uuid.UUID {
	var id uuid.UUID
	var key *string
	if s3Key != "" {
		key = &s3Key
		require.NoError(e.t, e.blobs.Put(e.t.Context(), s3Key, []byte("x"), ""))
	}
	require.NoError(e.t, e.pool.QueryRow(e.t.Context(), `
		INSERT INTO request (endpoint_id, org_id, method, path, received_at, body_s3_key, body_size)
		VALUES ($1, $2, 'POST', '/', now() - $3::interval, $4, 1) RETURNING id`,
		endpoint, e.org, age.String(), key).Scan(&id))
	return id
}

func (e *env) count(table string) int {
	var n int
	require.NoError(e.t, e.pool.QueryRow(e.t.Context(), "SELECT count(*) FROM "+table).Scan(&n))
	return n
}

func TestRetentionDeletesExpiredRequestsAndBodies(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	// Pro keeps up to 14 days, so both endpoints' settings apply.
	_, err := e.pool.Exec(t.Context(), `INSERT INTO subscription (org_id, plan) VALUES ($1, 'pro')`, e.org)
	require.NoError(t, err)
	short := e.endpoint("shortRetent1", 24)
	long := e.endpoint("longRetent01", 24*14)

	oldWithBody := e.request(short, 48*time.Hour, "org/short/old")
	e.request(short, 48*time.Hour, "")
	keep := e.request(short, time.Hour, "org/short/new")
	e.request(long, 48*time.Hour, "org/long/kept")

	var destID uuid.UUID
	require.NoError(t, e.pool.QueryRow(t.Context(), `INSERT INTO destination (endpoint_id, name, url) VALUES ($1, 'd', 'https://x.example') RETURNING id`, short).Scan(&destID))
	_, err = e.pool.Exec(t.Context(), `
		INSERT INTO delivery (request_id, request_received_at, destination_id, endpoint_id)
		SELECT id, received_at, $1, endpoint_id FROM request WHERE endpoint_id = $2`, destID, short)
	require.NoError(t, err)

	require.NoError(t, (&retentionWorker{d: e.d}).Work(t.Context(), &river.Job[retentionArgs]{}))

	var remaining []uuid.UUID
	rows, err := e.pool.Query(t.Context(), `SELECT id FROM request WHERE endpoint_id = $1`, short)
	require.NoError(t, err)
	for rows.Next() {
		var id uuid.UUID
		require.NoError(t, rows.Scan(&id))
		remaining = append(remaining, id)
	}
	assert.Equal(t, []uuid.UUID{keep}, remaining)
	assert.Equal(t, 4-2, e.count("request"), "the long-retention endpoint keeps its old request")
	assert.Equal(t, 1, e.count("delivery"), "deliveries of deleted requests are removed")
	_, err = e.blobs.Get(t.Context(), "org/short/old")
	require.ErrorIs(t, err, blob.ErrNotFound)
	_, err = e.blobs.Get(t.Context(), "org/long/kept")
	require.NoError(t, err)
	_ = oldWithBody
}

func TestRetentionDropsPartitionsBeyondTheLongestRetention(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.endpoint("onlyEndpoint", 24) // longest retention: 1 day

	require.NoError(t, (&retentionWorker{d: e.d}).Work(t.Context(), &river.Job[retentionArgs]{}))
	var oldest string
	require.NoError(t, e.pool.QueryRow(t.Context(), `
		SELECT min(c.relname) FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'request'::regclass`).Scan(&oldest))
	cutoff := time.Now().UTC().AddDate(0, 0, -2).Format("20060102")
	assert.GreaterOrEqual(t, oldest, "request_p"+cutoff)
}

func TestPartitionsAreKeptAWeekAhead(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	require.NoError(t, (&partitionsWorker{d: e.d}).Work(t.Context(), &river.Job[partitionsArgs]{}))
	var newest string
	require.NoError(t, e.pool.QueryRow(t.Context(), `
		SELECT max(c.relname) FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'request'::regclass`).Scan(&newest))
	assert.Equal(t, "request_p"+time.Now().UTC().AddDate(0, 0, 7).Format("20060102"), newest)
}

func TestAnonymousEndpointsExpire(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	_, err := e.pool.Exec(t.Context(), `
		INSERT INTO endpoint (slug, name, expires_at) VALUES
		  ('expiredAnon1', 'x', now() - interval '2 hours'),
		  ('graceAnon001', 'x', now() - interval '10 minutes'),
		  ('liveAnon0001', 'x', now() + interval '1 hour')`)
	require.NoError(t, err)
	require.NoError(t, (&anonymousWorker{d: e.d}).Work(t.Context(), &river.Job[anonymousExpireArgs]{}))
	var slugs []string
	rows, err := e.pool.Query(t.Context(), `SELECT slug FROM endpoint WHERE org_id IS NULL ORDER BY slug`)
	require.NoError(t, err)
	for rows.Next() {
		var s string
		require.NoError(t, rows.Scan(&s))
		slugs = append(slugs, s)
	}
	assert.Equal(t, []string{"graceAnon001", "liveAnon0001"}, slugs)
}

func TestUsageRollup(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ep := e.endpoint("usageEndpnt1", 24)
	e.request(ep, time.Minute, "")
	e.request(ep, 2*time.Minute, "")
	require.NoError(t, (&rollupWorker{d: e.d}).Work(t.Context(), &river.Job[usageRollupArgs]{}))
	require.NoError(t, (&rollupWorker{d: e.d}).Work(t.Context(), &river.Job[usageRollupArgs]{}), "idempotent")
	var requests, bytes int
	require.NoError(t, e.pool.QueryRow(t.Context(),
		`SELECT sum(requests), sum(bytes) FROM usage_daily WHERE org_id = $1`, e.org).Scan(&requests, &bytes))
	assert.Equal(t, 2, requests)
	assert.Equal(t, 2, bytes)
}

func TestOrphanedBodiesAreDeleted(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ep := e.endpoint("orphanEndpnt", 24*30)
	alive := e.request(ep, time.Minute, "")
	aliveKey := "org/ep/2026/01/01/" + alive.String()
	orphanKey := "org/ep/2026/01/01/" + uuid.NewString()
	youngOrphan := "org/ep/2026/01/01/" + uuid.NewString()
	for _, k := range []string{aliveKey, orphanKey, youngOrphan, "unrelated/readme.txt"} {
		require.NoError(t, e.blobs.Put(t.Context(), k, []byte("x"), ""))
	}
	old := time.Now().Add(-2 * time.Hour)
	for _, k := range []string{aliveKey, orphanKey, "unrelated/readme.txt"} {
		e.blobs.Backdate(k, old)
	}

	require.NoError(t, (&orphansWorker{d: e.d}).Work(t.Context(), &river.Job[orphansArgs]{}))
	for key, kept := range map[string]bool{aliveKey: true, orphanKey: false, youngOrphan: true, "unrelated/readme.txt": true} {
		_, err := e.blobs.Get(t.Context(), key)
		if kept {
			require.NoError(t, err, key)
		} else {
			require.ErrorIs(t, err, blob.ErrNotFound, key)
		}
	}
}

func TestRetentionIsCappedByThePlan(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	// Configured for 14 days under a bigger plan, now on free (24 hours).
	ep := e.endpoint("downgraded01", 24*14)
	old := e.request(ep, 48*time.Hour, "")
	keep := e.request(ep, time.Hour, "")

	require.NoError(t, (&retentionWorker{d: e.d}).Work(t.Context(), &river.Job[retentionArgs]{}))
	var ids []uuid.UUID
	rows, err := e.pool.Query(t.Context(), `SELECT id FROM request WHERE endpoint_id = $1`, ep)
	require.NoError(t, err)
	for rows.Next() {
		var id uuid.UUID
		require.NoError(t, rows.Scan(&id))
		ids = append(ids, id)
	}
	assert.Equal(t, []uuid.UUID{keep}, ids)
	assert.NotContains(t, ids, old)

	// The unlimited override keeps the endpoint's own setting.
	e.d.PlanOverride = "unlimited"
	older := e.request(ep, 72*time.Hour, "")
	require.NoError(t, (&retentionWorker{d: e.d}).Work(t.Context(), &river.Job[retentionArgs]{}))
	var n int
	require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT count(*) FROM request WHERE id = $1`, older).Scan(&n))
	assert.Equal(t, 1, n)
}
