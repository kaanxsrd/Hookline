// Package stream serves live endpoint events to dashboards over SSE, fed by
// a pubsub.Hub (one Redis subscription per process).
package stream

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/services/edge/internal/live"
	"github.com/kaanxsrd/hookline/services/edge/internal/metrics"
	"github.com/kaanxsrd/hookline/services/edge/internal/pubsub"
	"github.com/kaanxsrd/hookline/services/edge/internal/streamauth"
)

const (
	// MaxReplay bounds how many missed requests a reconnect replays.
	MaxReplay = 500
	// replaySkew widens the replay window for clock differences between edges.
	replaySkew   = time.Minute
	writeTimeout = 10 * time.Second
)

// Handler serves GET /v1/stream/{endpointId}?token=...
//
// Events:
//
//	request   a captured request (id: the request ID, data: summary JSON)
//	delivery  a delivery status change
//	endpoint  the endpoint's settings changed
//	ping      every PingInterval, so proxies keep the connection open
//	resync    more than MaxReplay requests were missed; reload the list
//	reconnect the edge is shutting down; reconnect (data: retry_ms)
type Handler struct {
	Hub          *pubsub.Hub
	Queries      *dbq.Queries
	Tokens       *streamauth.Verifier
	AllowOrigin  string // the web app's origin, for cross-origin EventSource in development
	Metrics      *metrics.Metrics
	Logger       *slog.Logger
	PingInterval time.Duration
	Now          func() time.Time
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.AllowOrigin != "" {
		w.Header().Set("Access-Control-Allow-Origin", h.AllowOrigin)
		w.Header().Add("Vary", "Origin")
	}
	endpointID, err := uuid.Parse(chi.URLParam(r, "endpointId"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Unknown endpoint.")
		return
	}
	claims, err := h.Tokens.Verify(r.URL.Query().Get("token"), h.now())
	if err != nil {
		httpx.WriteError(w, http.StatusUnauthorized, "invalid_token", "The stream token is missing, invalid or expired.")
		return
	}
	if claims.Endpoint != endpointID {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "This token is for a different endpoint.")
		return
	}

	ctx := r.Context()
	// Subscribe before replaying so nothing published in between is lost;
	// duplicates are filtered below.
	sub, err := h.Hub.Subscribe(ctx, live.Channel(endpointID))
	if err != nil {
		h.Logger.WarnContext(ctx, "live stream unavailable", "error", err)
		w.Header().Set("Retry-After", "5")
		httpx.WriteError(w, http.StatusServiceUnavailable, "live_unavailable", "Live updates are temporarily unavailable.")
		return
	}
	// The request context is already cancelled when the viewer leaves.
	defer h.Hub.Unsubscribe(context.WithoutCancel(ctx), sub)

	h.Metrics.SSEClients.Inc()
	defer h.Metrics.SSEClients.Dec()

	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream; charset=utf-8")
	hdr.Set("Cache-Control", "no-cache, no-transform")
	hdr.Set("X-Accel-Buffering", "no") // disable proxy buffering
	hdr.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)

	out := &eventWriter{w: w, rc: http.NewResponseController(w)}
	if out.raw([]byte("retry: 3000\n: connected\n\n")) != nil {
		return
	}

	replayed, err := h.replay(ctx, out, endpointID, lastEventID(r))
	if err != nil {
		return
	}

	ping := time.NewTicker(h.pingInterval())
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-sub.Done():
			if sub.Reason() == pubsub.ReasonShutdown {
				_ = out.event("reconnect", "", []byte(`{"retry_ms":1000}`))
			}
			return
		case <-ping.C:
			if out.event("ping", "", []byte("{}")) != nil {
				return
			}
		case msg := <-sub.Events():
			var ev live.Event
			if json.Unmarshal(msg, &ev) != nil || ev.Type == "" {
				continue
			}
			id := ""
			if ev.Type == "request" {
				var s struct {
					ID uuid.UUID `json:"id"`
				}
				if json.Unmarshal(ev.Payload, &s) == nil {
					if _, dup := replayed[s.ID]; dup {
						continue
					}
					id = s.ID.String()
				}
			}
			if out.event(ev.Type, id, ev.Payload) != nil {
				return
			}
			h.Metrics.SSEEvents.Inc()
		}
	}
}

// replay sends requests received after lastID and returns their IDs.
func (h *Handler) replay(ctx context.Context, out *eventWriter, endpointID uuid.UUID, lastID uuid.UUID) (map[uuid.UUID]struct{}, error) {
	sent := map[uuid.UUID]struct{}{}
	if lastID == uuid.Nil {
		return sent, nil
	}
	sec, nsec := lastID.Time().UnixTime()
	rows, err := h.Queries.ListRequestSummariesAfter(ctx, dbq.ListRequestSummariesAfterParams{
		EndpointID: endpointID,
		Since:      time.Unix(sec, nsec).Add(-replaySkew),
		AfterID:    lastID,
		MaxRows:    MaxReplay,
	})
	if err != nil {
		h.Logger.WarnContext(ctx, "replay missed requests", "error", err)
		return sent, out.event("resync", "", []byte(`{"reason":"replay_failed"}`))
	}
	for _, row := range rows {
		payload, err := json.Marshal(summaryFromRow(row))
		if err != nil {
			return nil, err
		}
		if err := out.event("request", row.ID.String(), payload); err != nil {
			return nil, err
		}
		sent[row.ID] = struct{}{}
	}
	if len(rows) == MaxReplay {
		return sent, out.event("resync", "", []byte(`{"reason":"too_many_missed"}`))
	}
	return sent, nil
}

func summaryFromRow(r dbq.ListRequestSummariesAfterRow) live.RequestSummary {
	s := live.RequestSummary{
		ID:              r.ID,
		EndpointID:      r.EndpointID,
		Method:          r.Method,
		Path:            r.Path,
		BodySize:        int(r.BodySize),
		SignatureStatus: string(r.SignatureStatus),
		ReceivedAt:      r.ReceivedAt,
	}
	if r.ContentType != nil {
		s.ContentType = *r.ContentType
	}
	if r.SourceIp != nil {
		s.SourceIP = r.SourceIp.String()
	}
	if r.ResponseStatus != nil {
		s.ResponseStatus = int(*r.ResponseStatus)
	}
	return s
}

// lastEventID reads the resume point: the Last-Event-ID header (sent by
// EventSource on automatic reconnects) or the last_event_id query parameter
// (used when the client reconnects itself with a fresh token).
func lastEventID(r *http.Request) uuid.UUID {
	raw := r.Header.Get("Last-Event-ID")
	if raw == "" {
		raw = r.URL.Query().Get("last_event_id")
	}
	id, err := uuid.Parse(raw)
	if err != nil || id.Version() != 7 {
		return uuid.Nil
	}
	return id
}

func (h *Handler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func (h *Handler) pingInterval() time.Duration {
	if h.PingInterval > 0 {
		return h.PingInterval
	}
	return 15 * time.Second
}

type eventWriter struct {
	w  http.ResponseWriter
	rc *http.ResponseController
}

func (e *eventWriter) event(name, id string, data []byte) error {
	var b bytes.Buffer
	if id != "" {
		b.WriteString("id: " + id + "\n")
	}
	b.WriteString("event: " + name + "\n")
	for line := range bytes.SplitSeq(data, []byte("\n")) {
		b.WriteString("data: ")
		b.Write(line)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	return e.raw(b.Bytes())
}

func (e *eventWriter) raw(p []byte) error {
	// Streams have no server-wide write timeout; bound each write instead so
	// a stalled client is noticed.
	if err := e.rc.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return err
	}
	if _, err := e.w.Write(p); err != nil {
		return err
	}
	return e.rc.Flush()
}
