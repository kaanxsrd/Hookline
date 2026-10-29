package notify

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbtest"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/packages/gocommon/mail"
)

func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }

type outbox struct {
	mu   sync.Mutex
	sent []mail.Message
	fail bool
}

func (o *outbox) Send(_ context.Context, m mail.Message) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.fail {
		return assert.AnError
	}
	o.sent = append(o.sent, m)
	return nil
}

func (o *outbox) count() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.sent)
}

type env struct {
	t    *testing.T
	pool *pgxpool.Pool
	box  *outbox
	d    *Deps
	org  uuid.UUID
	now  time.Time
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pool := dbtest.New(t)
	e := &env{t: t, pool: pool, box: &outbox{}, now: time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)}
	e.d = &Deps{Queries: dbq.New(pool), Mail: e.box, AppURL: "https://hookline.test", Logger: logging.Discard(), Now: func() time.Time { return e.now }}
	ctx := t.Context()
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO organization (name, slug) VALUES ('Acme', 'acme') RETURNING id`).Scan(&e.org))
	for i, role := range []string{"owner", "admin", "member"} {
		var user uuid.UUID
		require.NoError(t, pool.QueryRow(ctx, `INSERT INTO "user" (name, email) VALUES ($1, $2) RETURNING id`,
			role, role+"@acme.test").Scan(&user))
		_, err := pool.Exec(ctx, `INSERT INTO member (organization_id, user_id, role) VALUES ($1, $2, $3)`, e.org, user, role)
		require.NoError(t, err, i)
	}
	return e
}

func TestDeliveryFailingIsDebouncedPerDestination(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var endpoint, dest uuid.UUID
	ctx := t.Context()
	require.NoError(t, e.pool.QueryRow(ctx, `INSERT INTO endpoint (org_id, slug, name) VALUES ($1, 'failingEndpt', 'Stripe') RETURNING id`, e.org).Scan(&endpoint))
	require.NoError(t, e.pool.QueryRow(ctx, `INSERT INTO destination (endpoint_id, name, url) VALUES ($1, 'API', 'https://api.example.com') RETURNING id`, endpoint).Scan(&dest))

	w := &deliveryFailingWorker{d: e.d}
	job := &river.Job[DeliveryFailingArgs]{Args: DeliveryFailingArgs{DestinationID: dest, LastResult: "HTTP 503"}}
	require.NoError(t, w.Work(ctx, job))
	require.NoError(t, w.Work(ctx, job), "a second failure within the hour sends nothing")
	require.Equal(t, 1, e.box.count())
	m := e.box.sent[0]
	assert.Equal(t, []string{"admin@acme.test", "owner@acme.test"}, m.To, "owners and admins, not members")
	assert.Equal(t, "Deliveries to API are failing", m.Subject)
	data := m.Data.(map[string]string)
	assert.Equal(t, "HTTP 503", data["LastResult"])
	assert.Equal(t, "https://hookline.test/acme/deliveries?status=failed", data["URL"])
	_, _, err := mail.Render(m.Template, m.Data)
	require.NoError(t, err)

	// An hour later it may be sent again.
	_, err = e.pool.Exec(ctx, `UPDATE notification_log SET sent_at = now() - interval '61 minutes'`)
	require.NoError(t, err)
	require.NoError(t, w.Work(ctx, job))
	assert.Equal(t, 2, e.box.count())
}

func TestFailedSendReleasesTheClaim(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var endpoint, dest uuid.UUID
	ctx := t.Context()
	require.NoError(t, e.pool.QueryRow(ctx, `INSERT INTO endpoint (org_id, slug, name) VALUES ($1, 'releaseEndpt', 'x') RETURNING id`, e.org).Scan(&endpoint))
	require.NoError(t, e.pool.QueryRow(ctx, `INSERT INTO destination (endpoint_id, name, url) VALUES ($1, 'API', 'https://api.example.com') RETURNING id`, endpoint).Scan(&dest))
	w := &deliveryFailingWorker{d: e.d}
	job := &river.Job[DeliveryFailingArgs]{Args: DeliveryFailingArgs{DestinationID: dest}}

	e.box.fail = true
	require.Error(t, w.Work(ctx, job))
	e.box.fail = false
	require.NoError(t, w.Work(ctx, job), "the retry sends")
	assert.Equal(t, 1, e.box.count())
}

func (e *env) usage(requests int) {
	e.t.Helper()
	_, err := e.pool.Exec(e.t.Context(), `
		INSERT INTO usage_daily (org_id, day, requests) VALUES ($1, '2026-10-05', $2)
		ON CONFLICT (org_id, day) DO UPDATE SET requests = EXCLUDED.requests`, e.org, requests)
	require.NoError(e.t, err)
}

func TestUsageThresholdsAreSentOncePerMonth(t *testing.T) {
	t.Parallel()
	e := newEnv(t) // free plan: 5,000 requests a month
	ctx := t.Context()

	e.usage(3000)
	require.NoError(t, e.d.CheckUsage(ctx))
	assert.Equal(t, 0, e.box.count())

	e.usage(4100)
	require.NoError(t, e.d.CheckUsage(ctx))
	require.NoError(t, e.d.CheckUsage(ctx))
	require.Equal(t, 1, e.box.count())
	assert.Contains(t, e.box.sent[0].Subject, "80%")
	assert.Equal(t, "4,100", e.box.sent[0].Data.(map[string]string)["Used"])

	e.usage(5000)
	require.NoError(t, e.d.CheckUsage(ctx))
	require.NoError(t, e.d.CheckUsage(ctx))
	require.Equal(t, 2, e.box.count())
	assert.Contains(t, e.box.sent[1].Subject, "100%")
}

func TestUsageJumpingStraightTo100SendsOneEmail(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.usage(6000)
	require.NoError(t, e.d.CheckUsage(t.Context()))
	require.NoError(t, e.d.CheckUsage(t.Context()))
	require.Equal(t, 1, e.box.count())
	assert.Contains(t, e.box.sent[0].Subject, "100%")
}

func TestUnlimitedPlansAreNotNotified(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.d.PlanOverride = "unlimited"
	e.usage(1_000_000)
	require.NoError(t, e.d.CheckUsage(t.Context()))
	assert.Equal(t, 0, e.box.count())
}

func TestThousands(t *testing.T) {
	assert.Equal(t, "0", thousands(0))
	assert.Equal(t, "999", thousands(999))
	assert.Equal(t, "1,000", thousands(1000))
	assert.Equal(t, "1,234,567", thousands(1234567))
}
