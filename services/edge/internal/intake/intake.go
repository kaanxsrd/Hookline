// Package intake captures webhooks sent to /h/{slug} and /h/{slug}/*.
//
// Lifecycle (docs/architecture.md): resolve the endpoint, rate limit, read
// the body within the plan's cap, store it (inline up to 64 KiB, otherwise in
// object storage first), insert the request row, announce it on Redis and
// answer with the endpoint's configured response.
package intake

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/clientip"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/services/edge/internal/counters"
	"github.com/kaanxsrd/hookline/services/edge/internal/endpoints"
	"github.com/kaanxsrd/hookline/services/edge/internal/live"
	"github.com/kaanxsrd/hookline/services/edge/internal/metrics"
	"github.com/kaanxsrd/hookline/services/edge/internal/ratelimit"
)

// InlineMaxBytes is the largest body stored in PostgreSQL; larger bodies go
// to object storage. Mirrors INLINE_BODY_MAX_BYTES in packages/db.
const InlineMaxBytes = 64 << 10

// EndpointSource resolves slugs.
type EndpointSource interface {
	Lookup(ctx context.Context, slug string) (endpoints.Endpoint, error)
}

// Deps are the handler's collaborators. Limiter, Blobs, Publisher and
// Counters may be nil: the corresponding feature is then disabled.
type Deps struct {
	Queries   *dbq.Queries
	Endpoints EndpointSource
	Limiter   *ratelimit.Limiter
	Blobs     blob.Store
	Publisher *live.Publisher
	Counters  *counters.Counters
	IPs       *clientip.Resolver
	Metrics   *metrics.Metrics
	Logger    *slog.Logger
	Now       func() time.Time
}

// Handler serves intake requests.
type Handler struct {
	Deps
	degraded *logging.Throttle
}

// New returns a Handler.
func New(d Deps) *Handler {
	if d.Now == nil {
		d.Now = time.Now
	}
	return &Handler{Deps: d, degraded: logging.NewThrottle(10 * time.Second)}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := h.Now()
	setBaseHeaders(w.Header())

	if isPreflight(r) {
		w.Header().Set("Access-Control-Allow-Methods", "*")
		if req := r.Header.Get("Access-Control-Request-Headers"); req != "" {
			w.Header().Set("Access-Control-Allow-Headers", req)
		}
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	slug := chi.URLParam(r, "slug")
	if !validSlug(slug) {
		h.reject(w, start, http.StatusNotFound, "not_found", "No endpoint exists at this URL.")
		return
	}

	ctx := r.Context()
	ep, err := h.Endpoints.Lookup(ctx, slug)
	switch {
	case errors.Is(err, endpoints.ErrNotFound):
		h.reject(w, start, http.StatusNotFound, "not_found", "No endpoint exists at this URL.")
		return
	case err != nil:
		h.Logger.ErrorContext(ctx, "endpoint lookup failed", "error", err)
		h.reject(w, start, http.StatusServiceUnavailable, "unavailable", "Hookline is temporarily unavailable. Retry shortly.")
		return
	}

	switch {
	case ep.Status == dbq.EndpointStatusPaused:
		h.reject(w, start, http.StatusGone, "endpoint_paused", "This endpoint is paused by its owner.")
		return
	case ep.Status == dbq.EndpointStatusDisabledByAdmin:
		h.reject(w, start, http.StatusGone, "endpoint_disabled", "This endpoint has been disabled.")
		return
	case ep.ExpiresAt != nil && !start.Before(*ep.ExpiresAt):
		h.reject(w, start, http.StatusGone, "endpoint_expired", "This temporary endpoint has expired.")
		return
	}

	ip := h.IPs.From(r)
	if h.Limiter != nil {
		d, err := h.Limiter.Allow(ctx, ep.ID, ratelimit.Rule{Rate: ep.Limits.IntakeRatePerSecond, Burst: ep.Limits.IntakeBurst}, ip)
		if err != nil {
			h.degrade(ctx, "redis", "rate_limit", err)
		}
		if !d.Allowed {
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(d.RetryAfter.Seconds()))))
			msg := "Too many requests to this endpoint. Slow down and retry."
			if d.Scope == ratelimit.ScopeIP {
				msg = "Too many requests from your address. Slow down and retry."
			}
			h.reject(w, start, http.StatusTooManyRequests, "rate_limited", msg)
			return
		}
	}

	if ep.Anonymous() {
		n, err := h.Queries.CountEndpointRequestsSince(ctx, dbq.CountEndpointRequestsSinceParams{EndpointID: ep.ID, Since: ep.CreatedAt})
		if err != nil {
			h.Logger.ErrorContext(ctx, "count anonymous requests", "error", err)
			h.reject(w, start, http.StatusServiceUnavailable, "unavailable", "Hookline is temporarily unavailable. Retry shortly.")
			return
		}
		if limit := entitlements.Anonymous().MaxRequests; n >= limit {
			h.reject(w, start, http.StatusTooManyRequests, "quota_exceeded",
				fmt.Sprintf("This temporary endpoint has received its maximum of %d requests. Sign up to keep capturing.", limit))
			return
		}
	}

	limit := ep.Limits.MaxBodyBytes
	if r.ContentLength > limit {
		h.rejectTooLarge(w, start, limit)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			h.rejectTooLarge(w, start, limit)
			return
		}
		h.reject(w, start, http.StatusBadRequest, "body_read_failed", "The request body could not be read.")
		return
	}

	id := requestID(r)
	receivedAt := start.UTC().Truncate(time.Microsecond)
	sum := sha256.Sum256(body)
	params := dbq.InsertRequestParams{
		ID:              id,
		ReceivedAt:      receivedAt,
		EndpointID:      ep.ID,
		OrgID:           ep.OrgID,
		Method:          r.Method,
		Path:            subPath(r, slug),
		ContentType:     nonEmpty(r.Header.Get("Content-Type")),
		BodySize:        int32(len(body)), //nolint:gosec // bounded by the plan's body cap
		BodySha256:      sum[:],
		UserAgent:       nonEmpty(r.UserAgent()),
		SignatureStatus: dbq.SignatureStatusUnchecked,
	}
	if ip.IsValid() {
		params.SourceIp = &ip
	}
	status := int32(ep.ResponseStatus) //nolint:gosec // constrained to 200..599 by the schema
	params.ResponseStatus = &status
	if params.Query, err = json.Marshal(queryPairs(r.URL.RawQuery)); err != nil {
		panic(err) // []Pair of strings always marshals
	}
	if params.Headers, err = json.Marshal(headerPairs(r)); err != nil {
		panic(err)
	}

	if len(body) > InlineMaxBytes {
		if h.Blobs == nil {
			h.reject(w, start, http.StatusServiceUnavailable, "storage_unavailable",
				fmt.Sprintf("Bodies over %d KiB need object storage, which is not configured.", InlineMaxBytes>>10))
			return
		}
		key := blob.Key(ep.OrgID, ep.ID, id, receivedAt)
		putCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := h.Blobs.Put(putCtx, key, body, r.Header.Get("Content-Type"))
		cancel()
		if err != nil {
			h.Logger.ErrorContext(ctx, "store large body", "error", err, "bytes", len(body))
			h.reject(w, start, http.StatusServiceUnavailable, "storage_unavailable", "Large bodies cannot be stored right now. Retry shortly.")
			return
		}
		params.BodyS3Key = &key
		h.Metrics.BodiesOffload.Inc()
	} else if len(body) > 0 {
		params.BodyInline = body
	}

	duration := float32(h.Now().Sub(start).Seconds() * 1000)
	params.DurationMs = &duration
	if err := h.insert(ctx, params); err != nil {
		h.Logger.ErrorContext(ctx, "store request", "error", err)
		if params.BodyS3Key != nil {
			_ = h.Blobs.Delete(context.WithoutCancel(ctx), *params.BodyS3Key)
		}
		h.reject(w, start, http.StatusServiceUnavailable, "unavailable", "Hookline is temporarily unavailable. Retry shortly.")
		return
	}

	if h.Counters != nil {
		h.Counters.Add(ep.ID, receivedAt)
	}
	h.publish(ctx, ep, params, ip.String())
	h.Metrics.IntakeBytes.Add(float64(len(body)))
	h.Metrics.IntakeDuration.WithLabelValues("captured").Observe(h.Now().Sub(start).Seconds())

	if ep.ResponseDelay > 0 {
		t := time.NewTimer(ep.ResponseDelay)
		select {
		case <-t.C:
		case <-ctx.Done():
			t.Stop()
			return
		}
	}
	respond(w, ep)
}

// insert stores the request row, creating a missing daily partition once:
// the worker keeps partitions 7 days ahead, so this only happens if it has
// been down for a week or the clock jumped.
func (h *Handler) insert(ctx context.Context, p dbq.InsertRequestParams) error {
	err := h.Queries.InsertRequest(ctx, p)
	if !isMissingPartition(err) {
		return err
	}
	day := p.ReceivedAt.UTC().Truncate(24 * time.Hour)
	if _, perr := h.Queries.EnsureRequestPartitions(ctx, dbq.EnsureRequestPartitionsParams{
		FromDay: day.AddDate(0, 0, -1), ToDay: day.AddDate(0, 0, 7),
	}); perr != nil {
		return fmt.Errorf("create missing partition: %w", perr)
	}
	h.Logger.WarnContext(ctx, "created missing request partitions", "day", day.Format(time.DateOnly))
	return h.Queries.InsertRequest(ctx, p)
}

func isMissingPartition(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23514" && strings.Contains(pgErr.Message, "no partition of relation")
}

func (h *Handler) publish(ctx context.Context, ep endpoints.Endpoint, p dbq.InsertRequestParams, ip string) {
	if h.Publisher == nil {
		return
	}
	s := live.RequestSummary{
		ID:              p.ID,
		EndpointID:      ep.ID,
		Method:          p.Method,
		Path:            p.Path,
		BodySize:        int(p.BodySize),
		SignatureStatus: string(p.SignatureStatus),
		ResponseStatus:  ep.ResponseStatus,
		ReceivedAt:      p.ReceivedAt,
	}
	if p.ContentType != nil {
		s.ContentType = *p.ContentType
	}
	if p.SourceIp != nil {
		s.SourceIP = ip
	}
	pubCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	if err := h.Publisher.PublishRequest(pubCtx, s); err != nil {
		h.degrade(ctx, "redis", "publish", err)
	}
}

func respond(w http.ResponseWriter, ep endpoints.Endpoint) {
	hdr := w.Header()
	for _, p := range ep.ResponseHeaders {
		if allowedResponseHeader(p[0], p[1]) {
			hdr.Add(p[0], p[1])
		}
	}
	if ep.ResponseBody != "" && hdr.Get("Content-Type") == "" {
		hdr.Set("Content-Type", "text/plain; charset=utf-8")
	}
	w.WriteHeader(ep.ResponseStatus)
	// Bodies are not allowed for HEAD, 204 and 304; net/http drops them.
	_, _ = io.WriteString(w, ep.ResponseBody)
}

func (h *Handler) reject(w http.ResponseWriter, start time.Time, status int, code, msg string) {
	h.Metrics.IntakeRejects.WithLabelValues(code).Inc()
	h.Metrics.IntakeDuration.WithLabelValues("rejected").Observe(h.Now().Sub(start).Seconds())
	httpx.WriteError(w, status, code, msg)
}

func (h *Handler) rejectTooLarge(w http.ResponseWriter, start time.Time, limit int64) {
	h.reject(w, start, http.StatusRequestEntityTooLarge, "body_too_large",
		fmt.Sprintf("The body exceeds this endpoint's limit of %d bytes.", limit))
}

func (h *Handler) degrade(ctx context.Context, dependency, operation string, err error) {
	h.Metrics.Degraded.WithLabelValues(dependency, operation).Inc()
	if ok, suppressed := h.degraded.Allow(time.Now()); ok {
		h.Logger.WarnContext(ctx, "dependency unavailable, failing open",
			"dependency", dependency, "operation", operation, "error", err, "suppressed", suppressed)
	}
}

// requestID reuses the ID from the RequestID middleware, so the
// X-Hookline-Request-Id a sender sees is the captured request's ID.
func requestID(r *http.Request) uuid.UUID {
	if id, err := uuid.Parse(httpx.RequestIDFrom(r.Context())); err == nil {
		return id
	}
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.New()
	}
	return id
}

// subPath is the escaped path after /h/{slug}, always starting with "/".
func subPath(r *http.Request, slug string) string {
	rest := strings.TrimPrefix(r.URL.EscapedPath(), "/h/"+slug)
	if !strings.HasPrefix(rest, "/") {
		rest = "/" + rest
	}
	return rest
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
