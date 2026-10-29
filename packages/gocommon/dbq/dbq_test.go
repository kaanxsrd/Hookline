package dbq_test

import (
	"crypto/sha256"
	"encoding/json"
	"net/netip"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbtest"
)

type fixture struct {
	pool       *pgxpool.Pool
	q          *dbq.Queries
	orgID      uuid.UUID
	endpointID uuid.UUID
}

func setup(t *testing.T) fixture {
	t.Helper()
	pool := dbtest.New(t)
	ctx := t.Context()
	f := fixture{pool: pool, q: dbq.New(pool)}
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO organization (name, slug) VALUES ('Acme', 'acme') RETURNING id`).Scan(&f.orgID))
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO endpoint (org_id, slug, name, response_status, response_headers, response_body)
		VALUES ($1, 'abcDEF123456', 'Stripe', 202, '[["Content-Type","application/json"]]', '{"ok":true}')
		RETURNING id`, f.orgID).Scan(&f.endpointID))
	return f
}

func TestGetEndpointForIntake(t *testing.T) {
	t.Parallel()
	f := setup(t)

	ep, err := f.q.GetEndpointForIntake(t.Context(), "abcDEF123456")
	require.NoError(t, err)
	assert.Equal(t, f.endpointID, ep.ID)
	require.NotNil(t, ep.OrgID)
	assert.Equal(t, f.orgID, *ep.OrgID)
	assert.Equal(t, dbq.EndpointStatusActive, ep.Status)
	assert.Equal(t, dbq.ResponseModeStatic, ep.ResponseMode)
	assert.Equal(t, int32(202), ep.ResponseStatus)
	assert.JSONEq(t, `[["Content-Type","application/json"]]`, string(ep.ResponseHeaders))
	assert.Nil(t, ep.SignatureProvider)
	assert.Nil(t, ep.ExpiresAt)

	_, err = f.q.GetEndpointForIntake(t.Context(), "unknown12345")
	assert.ErrorIs(t, err, pgx.ErrNoRows)
}

func TestEndpointConstraints(t *testing.T) {
	t.Parallel()
	f := setup(t)
	ctx := t.Context()

	for name, stmt := range map[string]string{
		"slug too short":        `INSERT INTO endpoint (org_id, slug, name) VALUES ($1, 'short', 'x')`,
		"slug with symbols":     `INSERT INTO endpoint (org_id, slug, name) VALUES ($1, 'abc-def_1234', 'x')`,
		"anonymous w/o expiry":  `INSERT INTO endpoint (slug, name) SELECT 'anonymous123', 'x' WHERE $1::uuid IS NOT NULL`,
		"bad response status":   `INSERT INTO endpoint (org_id, slug, name, response_status) VALUES ($1, 'status999999', 'x', 999)`,
		"provider w/o a secret": `INSERT INTO endpoint (org_id, slug, name, signature_provider) VALUES ($1, 'provider1234', 'x', 'stripe')`,
	} {
		_, err := f.pool.Exec(ctx, stmt, f.orgID)
		var pgErr *pgconn.PgError
		require.ErrorAs(t, err, &pgErr, name)
		assert.Equal(t, "23514", pgErr.Code, "%s: want check_violation", name)
	}
}

func TestInsertRequestRoundTrip(t *testing.T) {
	t.Parallel()
	f := setup(t)
	ctx := t.Context()

	id, err := uuid.NewV7()
	require.NoError(t, err)
	received := time.Now().UTC().Truncate(time.Microsecond)
	body := []byte(`{"type":"payment_intent.succeeded","amount":4999}`)
	sum := sha256.Sum256(body)
	ip := netip.MustParseAddr("2001:db8::1")
	ct := "application/json"
	status := int32(202)
	duration := float32(1.25)

	require.NoError(t, f.q.InsertRequest(ctx, dbq.InsertRequestParams{
		ID:              id,
		ReceivedAt:      received,
		EndpointID:      f.endpointID,
		OrgID:           &f.orgID,
		Method:          "POST",
		Path:            "/stripe",
		Query:           json.RawMessage(`[["a","1"],["a","2"]]`),
		Headers:         json.RawMessage(`[["Content-Type","application/json"],["X-Dup","1"],["x-dup","2"]]`),
		ContentType:     &ct,
		BodyInline:      body,
		BodySize:        int32(len(body)),
		BodySha256:      sum[:],
		SourceIp:        &ip,
		SignatureStatus: dbq.SignatureStatusUnchecked,
		ResponseStatus:  &status,
		DurationMs:      &duration,
	}))

	var (
		gotBody    []byte
		gotIP      netip.Addr
		gotHeaders json.RawMessage
		gotAt      time.Time
	)
	require.NoError(t, f.pool.QueryRow(ctx,
		`SELECT body_inline, source_ip, headers, received_at FROM request WHERE id = $1`, id,
	).Scan(&gotBody, &gotIP, &gotHeaders, &gotAt))
	assert.Equal(t, body, gotBody)
	assert.Equal(t, ip, gotIP)
	assert.JSONEq(t, `[["Content-Type","application/json"],["X-Dup","1"],["x-dup","2"]]`, string(gotHeaders),
		"header order, case and duplicates are preserved")
	assert.True(t, received.Equal(gotAt))

	var hits int
	require.NoError(t, f.pool.QueryRow(ctx, `
		SELECT count(*) FROM request
		WHERE body_inline IS NOT NULL
		  AND encode(body_inline, 'escape') ILIKE '%' || encode(convert_to('payment_intent', 'UTF8'), 'escape') || '%'`,
	).Scan(&hits))
	assert.Equal(t, 1, hits, "trigram search projection finds the body")
}

func TestPartitions(t *testing.T) {
	t.Parallel()
	f := setup(t)
	ctx := t.Context()
	day := func(s string) time.Time {
		d, err := time.Parse(time.DateOnly, s)
		require.NoError(t, err)
		return d
	}

	created, err := f.q.EnsureRequestPartitions(ctx, dbq.EnsureRequestPartitionsParams{FromDay: day("2021-03-01"), ToDay: day("2021-03-03")})
	require.NoError(t, err)
	assert.Equal(t, int32(3), created)
	created, err = f.q.EnsureRequestPartitions(ctx, dbq.EnsureRequestPartitionsParams{FromDay: day("2021-03-01"), ToDay: day("2021-03-03")})
	require.NoError(t, err)
	assert.Zero(t, created, "existing partitions are skipped")

	// An insert into a day without a partition fails with SQLSTATE 23514;
	// intake reacts by calling EnsureRequestPartitions and retrying.
	id, _ := uuid.NewV7()
	err = f.q.InsertRequest(ctx, dbq.InsertRequestParams{
		ID: id, ReceivedAt: day("2021-04-01"), EndpointID: f.endpointID, Method: "GET", Path: "/",
		Query: json.RawMessage(`[]`), Headers: json.RawMessage(`[]`), SignatureStatus: dbq.SignatureStatusUnchecked,
	})
	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	assert.Equal(t, "23514", pgErr.Code)

	dropped, err := f.q.DropRequestPartitionsBefore(ctx, day("2021-03-03"))
	require.NoError(t, err)
	assert.Equal(t, []string{"request_p20210301", "request_p20210302"}, dropped)
}

func TestListEnabledDestinations(t *testing.T) {
	t.Parallel()
	f := setup(t)
	ctx := t.Context()

	_, err := f.pool.Exec(ctx, `
		INSERT INTO destination (endpoint_id, name, url, enabled, filter)
		VALUES ($1, 'on', 'https://example.com/a', true, '{"methods":["POST"]}'),
		       ($1, 'off', 'https://example.com/b', false, '{}')`, f.endpointID)
	require.NoError(t, err)

	_, err = f.pool.Exec(ctx, `INSERT INTO destination (endpoint_id, name, url) VALUES ($1, 'bad', 'ftp://x')`, f.endpointID)
	require.Error(t, err, "only http(s) destination URLs are accepted")

	dests, err := f.q.ListEnabledDestinations(ctx, f.endpointID)
	require.NoError(t, err)
	require.Len(t, dests, 1)
	assert.Equal(t, "on", dests[0].Name)
	assert.Equal(t, int32(8), dests[0].MaxAttempts)
	assert.JSONEq(t, `{"methods":["POST"]}`, string(dests[0].Filter))
}

func TestAPIKeys(t *testing.T) {
	t.Parallel()
	f := setup(t)
	ctx := t.Context()

	hash := func(s string) []byte { h := sha256.Sum256([]byte(s)); return h[:] }
	insert := func(raw, extra string) uuid.UUID {
		var id uuid.UUID
		require.NoError(t, f.pool.QueryRow(ctx, `
			INSERT INTO api_key (org_id, name, prefix, hash, scopes, revoked_at, expires_at)
			VALUES ($1, 'k', 'abcd1234', $2, ARRAY['tunnel','requests:read'],
			        CASE WHEN $3 = 'revoked' THEN now() END,
			        CASE WHEN $3 = 'expired' THEN now() - interval '1 day' END)
			RETURNING id`, f.orgID, hash(raw), extra).Scan(&id))
		return id
	}
	live := insert("hk_live_live", "")
	insert("hk_live_revoked", "revoked")
	insert("hk_live_expired", "expired")

	key, err := f.q.GetAPIKeyByHash(ctx, hash("hk_live_live"))
	require.NoError(t, err)
	assert.Equal(t, live, key.ID)
	assert.Equal(t, []string{"tunnel", "requests:read"}, key.Scopes)

	for _, raw := range []string{"hk_live_revoked", "hk_live_expired", "hk_live_unknown"} {
		_, err := f.q.GetAPIKeyByHash(ctx, hash(raw))
		require.ErrorIs(t, err, pgx.ErrNoRows, raw)
	}

	_, err = f.pool.Exec(ctx, `INSERT INTO api_key (org_id, name, prefix, hash, scopes) VALUES ($1, 'x', 'x', '\x00', ARRAY['billing'])`, f.orgID)
	require.Error(t, err, "unknown scopes are rejected")

	require.NoError(t, f.q.TouchAPIKey(ctx, live))
	var first time.Time
	require.NoError(t, f.pool.QueryRow(ctx, `SELECT last_used_at FROM api_key WHERE id = $1`, live).Scan(&first))
	require.NoError(t, f.q.TouchAPIKey(ctx, live))
	var second time.Time
	require.NoError(t, f.pool.QueryRow(ctx, `SELECT last_used_at FROM api_key WHERE id = $1`, live).Scan(&second))
	assert.Equal(t, first, second, "touch is throttled to once a minute")
}
