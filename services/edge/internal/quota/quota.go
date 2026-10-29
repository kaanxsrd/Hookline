// Package quota enforces the plan's monthly request allowance per
// organization. A Redis counter per organization and month is seeded from
// PostgreSQL (rolled-up days plus today's rows) the first time it is needed,
// then incremented for every captured request, so checks cost one GET.
package quota

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
)

// ttl outlives the month so a counter never expires mid-month.
const ttl = 40 * 24 * time.Hour

// Quota checks and counts monthly requests.
type Quota struct {
	RDB     *redis.Client
	Queries *dbq.Queries
	Now     func() time.Time
}

func (q *Quota) key(org uuid.UUID) string {
	return "quota:req:" + org.String() + ":" + q.Now().UTC().Format("2006-01")
}

// Used returns the organization's requests this month, seeding the counter
// from PostgreSQL when Redis has none.
func (q *Quota) Used(ctx context.Context, org uuid.UUID) (int64, error) {
	key := q.key(org)
	n, err := q.RDB.Get(ctx, key).Int64()
	if err == nil {
		return n, nil
	}
	if !errors.Is(err, redis.Nil) {
		return 0, err
	}
	now := q.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	count, err := q.Queries.CountOrgRequestsThisMonth(ctx, dbq.CountOrgRequestsThisMonthParams{
		OrgID: org, MonthStart: monthStart, Today: today,
	})
	if err != nil {
		return 0, err
	}
	// Another instance may have seeded (and counted) meanwhile; keep theirs.
	if err := q.RDB.SetNX(ctx, key, count, ttl).Err(); err != nil {
		return 0, err
	}
	return q.RDB.Get(ctx, key).Int64()
}

// Allow reports whether one more request fits within limit.
func (q *Quota) Allow(ctx context.Context, org uuid.UUID, limit int64) (bool, error) {
	used, err := q.Used(ctx, org)
	if err != nil {
		return true, err // fail open: capturing beats refusing during an outage
	}
	return used < limit, nil
}

// Add counts one captured request.
func (q *Quota) Add(ctx context.Context, org uuid.UUID) error {
	key := q.key(org)
	pipe := q.RDB.Pipeline()
	pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	return err
}
