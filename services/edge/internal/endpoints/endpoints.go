// Package endpoints resolves an intake slug to the endpoint settings intake
// needs, through a short-lived Redis cache in front of PostgreSQL.
package endpoints

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
)

// ErrNotFound means no endpoint has the slug.
var ErrNotFound = errors.New("endpoint not found")

// Cache lifetimes. The web app deletes the key when settings change, so the
// TTL only bounds staleness if that deletion is lost.
const (
	ttl         = 60 * time.Second
	negativeTTL = 10 * time.Second
	missMarker  = "-"
)

// Pair is a header name and value.
type Pair = [2]string

// Endpoint is the subset of an endpoint used by intake. It is cached as JSON.
type Endpoint struct {
	ID                 uuid.UUID           `json:"id"`
	OrgID              *uuid.UUID          `json:"org_id"`
	Slug               string              `json:"slug"`
	Status             dbq.EndpointStatus  `json:"status"`
	ResponseMode       dbq.ResponseMode    `json:"response_mode"`
	ResponseStatus     int                 `json:"response_status"`
	ResponseHeaders    []Pair              `json:"response_headers"`
	ResponseBody       string              `json:"response_body"`
	ResponseDelay      time.Duration       `json:"response_delay"`
	SyncTimeout        time.Duration       `json:"sync_timeout"`
	SignatureProvider  *string             `json:"signature_provider"`
	SignatureSecretEnc *string             `json:"signature_secret_enc"`
	ExpiresAt          *time.Time          `json:"expires_at"`
	CreatedAt          time.Time           `json:"created_at"`
	Plan               entitlements.Plan   `json:"plan"`
	Limits             entitlements.Limits `json:"-"`
}

// Anonymous reports whether the endpoint has no owning organization.
func (e *Endpoint) Anonymous() bool { return e.OrgID == nil }

// CacheKey is the Redis key holding the cached endpoint for slug.
func CacheKey(slug string) string { return "hl:ep:" + slug }

// Cache looks endpoints up by slug.
type Cache struct {
	q                *dbq.Queries
	rdb              *redis.Client
	instanceOverride entitlements.Plan
	logger           *slog.Logger
	degraded         *logging.Throttle
}

// NewCache returns a Cache. rdb may be nil to disable caching.
func NewCache(q *dbq.Queries, rdb *redis.Client, instanceOverride entitlements.Plan, logger *slog.Logger) *Cache {
	return &Cache{q: q, rdb: rdb, instanceOverride: instanceOverride, logger: logger, degraded: logging.NewThrottle(10 * time.Second)}
}

// Lookup returns the endpoint for slug, or ErrNotFound. Redis failures fall
// back to PostgreSQL; PostgreSQL failures are returned.
func (c *Cache) Lookup(ctx context.Context, slug string) (Endpoint, error) {
	switch ep, res := c.fromRedis(ctx, slug); res {
	case cacheHit:
		return ep, nil
	case cachedMiss:
		return Endpoint{}, ErrNotFound
	case cacheSkip:
	}

	row, err := c.q.GetEndpointForIntake(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		c.store(ctx, slug, []byte(missMarker), negativeTTL)
		return Endpoint{}, ErrNotFound
	}
	if err != nil {
		return Endpoint{}, fmt.Errorf("load endpoint: %w", err)
	}
	ep, err := fromRow(row)
	if err != nil {
		return Endpoint{}, err
	}
	if b, err := json.Marshal(ep); err == nil {
		c.store(ctx, slug, b, ttl)
	}
	return c.withLimits(ep), nil
}

type cacheResult int

const (
	cacheSkip  cacheResult = iota // not cached, or Redis unavailable: read PostgreSQL
	cacheHit                      // cached endpoint
	cachedMiss                    // cached "no such slug"
)

func (c *Cache) fromRedis(ctx context.Context, slug string) (Endpoint, cacheResult) {
	if c.rdb == nil {
		return Endpoint{}, cacheSkip
	}
	b, err := c.rdb.Get(ctx, CacheKey(slug)).Bytes()
	switch {
	case errors.Is(err, redis.Nil):
		return Endpoint{}, cacheSkip
	case err != nil:
		c.warn(ctx, "endpoint cache unavailable, reading PostgreSQL", err)
		return Endpoint{}, cacheSkip
	case string(b) == missMarker:
		return Endpoint{}, cachedMiss
	}
	var ep Endpoint
	if json.Unmarshal(b, &ep) != nil {
		// A corrupt or outdated entry: ignore it and reload.
		return Endpoint{}, cacheSkip
	}
	return c.withLimits(ep), cacheHit
}

func (c *Cache) store(ctx context.Context, slug string, value []byte, ttl time.Duration) {
	if c.rdb == nil {
		return
	}
	if err := c.rdb.Set(ctx, CacheKey(slug), value, ttl).Err(); err != nil {
		c.warn(ctx, "endpoint cache write failed", err)
	}
}

// withLimits resolves the plan in force (the instance override applies even
// to cached entries) and attaches its limits.
func (c *Cache) withLimits(ep Endpoint) Endpoint {
	if c.instanceOverride != "" {
		ep.Plan = c.instanceOverride
	}
	ep.Limits = entitlements.For(ep.Plan)
	return ep
}

func (c *Cache) warn(ctx context.Context, msg string, err error) {
	if ok, suppressed := c.degraded.Allow(time.Now()); ok {
		c.logger.WarnContext(ctx, msg, "error", err, "suppressed", suppressed)
	}
}

func fromRow(row dbq.GetEndpointForIntakeRow) (Endpoint, error) {
	var headers []Pair
	if len(row.ResponseHeaders) > 0 {
		if err := json.Unmarshal(row.ResponseHeaders, &headers); err != nil {
			return Endpoint{}, fmt.Errorf("endpoint %s: invalid response_headers: %w", row.ID, err)
		}
	}
	var provider *string
	if row.SignatureProvider != nil {
		p := string(*row.SignatureProvider)
		provider = &p
	}
	return Endpoint{
		ID:                 row.ID,
		OrgID:              row.OrgID,
		Slug:               row.Slug,
		Status:             row.Status,
		ResponseMode:       row.ResponseMode,
		ResponseStatus:     int(row.ResponseStatus),
		ResponseHeaders:    headers,
		ResponseBody:       row.ResponseBody,
		ResponseDelay:      time.Duration(row.ResponseDelayMs) * time.Millisecond,
		SyncTimeout:        time.Duration(row.SyncTimeoutMs) * time.Millisecond,
		SignatureProvider:  provider,
		SignatureSecretEnc: row.SignatureSecretEnc,
		ExpiresAt:          row.ExpiresAt,
		CreatedAt:          row.CreatedAt,
		Plan:               entitlements.Resolve("", row.OrgID != nil, planString(row.Plan), planString(row.PlanOverride)),
	}, nil
}

func planString(p *dbq.Plan) *string {
	if p == nil {
		return nil
	}
	s := string(*p)
	return &s
}
