package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/protocol"
	"github.com/kaanxsrd/hookline/services/edge/internal/apikey"
	"github.com/kaanxsrd/hookline/services/edge/internal/metrics"
	"github.com/kaanxsrd/hookline/services/edge/internal/pubsub"
)

// outBuffer is how many frames a session may have queued before it is
// considered too slow and closed (it reconnects and resumes).
const outBuffer = 256

// Deps are the tunnel server's collaborators. Blobs may be nil.
type Deps struct {
	Keys     *apikey.Authenticator
	Queries  *dbq.Queries
	Blobs    blob.Store
	RDB      *redis.Client
	Hub      *pubsub.Hub // request channels (tunnel:ep:*)
	Presence *Presence
	// PublicURL is the base of intake URLs shown to the CLI.
	PublicURL    string
	PlanOverride entitlements.Plan
	Metrics      *metrics.Metrics
	Logger       *slog.Logger
	Now          func() time.Time
	// PingInterval defaults to protocol.PingInterval; tests shorten it.
	PingInterval time.Duration
}

// Server serves /v1/tunnel.
type Server struct {
	Deps

	mu       sync.Mutex
	sessions map[*session]struct{}
	closing  bool
}

// NewServer returns a Server.
func NewServer(d Deps) *Server {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.PingInterval <= 0 {
		d.PingInterval = protocol.PingInterval
	}
	return &Server{Deps: d, sessions: map[*session]struct{}{}}
}

// Sessions returns how many tunnels this instance holds.
func (s *Server) Sessions() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sessions)
}

// Shutdown sends goaway to every session and closes it, so CLIs reconnect to
// another instance. Register it with http.Server.RegisterOnShutdown: hijacked
// WebSocket connections are not drained by the HTTP server.
func (s *Server) Shutdown() {
	s.mu.Lock()
	s.closing = true
	sessions := make([]*session, 0, len(s.sessions))
	for sess := range s.sessions {
		sessions = append(sessions, sess)
	}
	s.mu.Unlock()

	var wg sync.WaitGroup
	for _, sess := range sessions {
		wg.Go(sess.goAway)
	}
	wg.Wait()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	key, err := s.Keys.FromRequest(r)
	switch {
	case errors.Is(err, apikey.ErrMissing), errors.Is(err, apikey.ErrInvalid):
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "A valid API key is required. Run `hookline login`.")
		return
	case err != nil:
		s.Logger.ErrorContext(r.Context(), "authenticate tunnel", "error", err)
		httpx.WriteError(w, http.StatusServiceUnavailable, "unavailable", "Hookline is temporarily unavailable. Retry shortly.")
		return
	case !key.Has(apikey.ScopeTunnel):
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "This API key does not have the tunnel scope.")
		return
	}
	s.mu.Lock()
	closing := s.closing
	s.mu.Unlock()
	if closing {
		httpx.WriteError(w, http.StatusServiceUnavailable, "shutting_down", "This server is restarting. Reconnect shortly.")
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{protocol.Subprotocol}})
	if err != nil {
		return // Accept has answered the request
	}
	if conn.Subprotocol() != protocol.Subprotocol {
		_ = conn.Close(protocol.CloseInvalidMessage, "negotiate the "+protocol.Subprotocol+" subprotocol")
		return
	}
	conn.SetReadLimit(protocol.HardMessageBytes)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	sess := &session{
		srv:    s,
		id:     uuid.NewString(),
		conn:   conn,
		key:    key,
		out:    make(chan []byte, outBuffer),
		cancel: cancel,
	}
	sess.seen()
	sess.run(ctx)
}

type session struct {
	srv    *Server
	id     string
	conn   *websocket.Conn
	key    apikey.Key
	hello  protocol.Hello
	eps    []dbq.ListOrgEndpointsBySlugsRow
	epIDs  []uuid.UUID
	out    chan []byte
	cancel context.CancelFunc

	lastSeen  atomic.Int64
	closeOnce sync.Once
}

func (ss *session) seen() { ss.lastSeen.Store(ss.srv.Now().UnixNano()) }

// close ends the session with a WebSocket close code (once).
func (ss *session) close(code int, reason string) {
	ss.closeOnce.Do(func() {
		_ = ss.conn.Close(websocket.StatusCode(code), reason)
		ss.cancel()
	})
}

// fail sends an error frame, then closes.
func (ss *session) fail(ctx context.Context, code int, errCode, msg string) {
	ss.writeNow(ctx, protocol.Error{Type: protocol.TypeError, Code: errCode, Message: msg})
	ss.close(code, errCode)
}

// writeNow writes a frame directly; only used before the writer starts and
// when shutting down.
func (ss *session) writeNow(ctx context.Context, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = ss.conn.Write(wctx, websocket.MessageText, b)
}

// send queues a frame; a full queue means the client cannot keep up.
func (ss *session) send(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	ss.sendRaw(b, string(typeOf(v)))
}

func (ss *session) sendRaw(b []byte, typ string) {
	select {
	case ss.out <- b:
		ss.srv.Metrics.TunnelFrames.WithLabelValues("out", typ).Inc()
	default:
		go ss.close(protocol.CloseLagging, "client too slow; reconnect to resume")
	}
}

func typeOf(v any) protocol.Type {
	switch m := v.(type) {
	case protocol.Ready:
		return m.Type
	case protocol.Request:
		return m.Type
	case protocol.Error:
		return m.Type
	case protocol.Ping:
		return m.Type
	case protocol.GoAway:
		return m.Type
	}
	return "unknown"
}

func (ss *session) goAway() {
	ctx := context.Background()
	ss.writeNow(ctx, protocol.GoAway{
		Type:   protocol.TypeGoAway,
		Reason: "server_restart",
		// Spread reconnects so the remaining instances are not stampeded.
		ReconnectAfterMS: 250 + rand.IntN(2000), //nolint:gosec // jitter, not security
	})
	ss.close(protocol.CloseGoingAway, "server restarting")
}

func (ss *session) run(ctx context.Context) {
	srv := ss.srv
	if !ss.readHello(ctx) {
		return
	}
	if !ss.resolveEndpoints(ctx) {
		return
	}

	limits, ok := ss.acquireSlot(ctx)
	if !ok {
		return
	}
	started := srv.Now()
	srv.mu.Lock()
	srv.sessions[ss] = struct{}{}
	srv.mu.Unlock()
	srv.Metrics.TunnelSessions.Inc()
	defer func() {
		srv.mu.Lock()
		delete(srv.sessions, ss)
		srv.mu.Unlock()
		srv.Metrics.TunnelSessions.Dec()
		ss.finish(ctx, started)
	}()

	subs := make([]*pubsub.Subscriber, 0, len(ss.epIDs))
	defer func() {
		for _, sub := range subs {
			srv.Hub.Unsubscribe(context.WithoutCancel(ctx), sub)
		}
	}()
	for _, id := range ss.epIDs {
		sub, err := srv.Hub.Subscribe(ctx, RequestChannel(id))
		if err != nil {
			srv.Logger.WarnContext(ctx, "tunnel subscribe failed", "error", err)
			ss.fail(ctx, protocol.CloseGoingAway, protocol.CodeInternal, "Live routing is unavailable right now. Retry shortly.")
			return
		}
		subs = append(subs, sub)
	}
	if err := srv.Presence.Join(ctx, ss.id, ss.epIDs); err != nil {
		srv.Logger.DebugContext(ctx, "tunnel presence join", "error", err)
	}

	go ss.writer(ctx)
	ss.send(ss.ready(limits))
	ss.replay(ctx)
	for _, sub := range subs {
		go ss.forward(ctx, sub)
	}
	go ss.keepAlive(ctx)
	ss.readLoop(ctx)
}

func (ss *session) readHello(ctx context.Context) bool {
	hctx, cancel := context.WithTimeout(ctx, protocol.HelloTimeout)
	defer cancel()
	typ, data, err := ss.conn.Read(hctx)
	if err != nil {
		ss.close(protocol.CloseInvalidMessage, "expected hello")
		return false
	}
	ss.seen()
	if typ != websocket.MessageText {
		ss.fail(ctx, protocol.CloseInvalidMessage, protocol.CodeInvalidMessage, "Frames must be JSON text messages.")
		return false
	}
	if t, _, err := protocol.Peek(data); err != nil || t != protocol.TypeHello {
		ss.fail(ctx, protocol.CloseInvalidMessage, protocol.CodeInvalidMessage, "The first frame must be hello.")
		return false
	}
	if err := protocol.Decode(data, &ss.hello); err != nil {
		ss.fail(ctx, protocol.CloseInvalidMessage, protocol.CodeInvalidMessage, err.Error())
		return false
	}
	if ss.hello.Protocol > protocol.Version {
		ss.fail(ctx, protocol.CloseUnsupportedProtocol, protocol.CodeUnsupportedProtocol, fmt.Sprintf(
			"This server speaks tunnel protocol %d but your CLI speaks %d. Use a CLI release that matches this server.",
			protocol.Version, ss.hello.Protocol))
		return false
	}
	if err := ss.hello.Validate(); err != nil {
		ss.fail(ctx, protocol.CloseInvalidMessage, protocol.CodeInvalidMessage, err.Error())
		return false
	}
	return true
}

func (ss *session) resolveEndpoints(ctx context.Context) bool {
	slugs := slices.Compact(slices.Sorted(slices.Values(ss.hello.Endpoints)))
	orgID := ss.key.OrgID
	rows, err := ss.srv.Queries.ListOrgEndpointsBySlugs(ctx, dbq.ListOrgEndpointsBySlugsParams{OrgID: &orgID, Slugs: slugs})
	if err != nil {
		ss.srv.Logger.ErrorContext(ctx, "resolve tunnel endpoints", "error", err)
		ss.fail(ctx, protocol.CloseGoingAway, protocol.CodeInternal, "Hookline is temporarily unavailable. Retry shortly.")
		return false
	}
	var missing []string
	for _, slug := range slugs {
		if !slices.ContainsFunc(rows, func(r dbq.ListOrgEndpointsBySlugsRow) bool { return r.Slug == slug }) {
			missing = append(missing, slug)
		}
	}
	if len(missing) > 0 {
		ss.fail(ctx, protocol.CloseUnknownEndpoint, protocol.CodeUnknownEndpoint,
			"No endpoint "+strings.Join(missing, ", ")+" in this API key's organization.")
		return false
	}
	ss.eps = rows
	for _, r := range rows {
		ss.epIDs = append(ss.epIDs, r.ID)
	}
	return true
}

func (ss *session) acquireSlot(ctx context.Context) (protocol.Limits, bool) {
	srv := ss.srv
	limits := protocol.Limits{
		MaxMessageBytes: protocol.MaxMessageBytes,
		PingIntervalMS:  int(srv.PingInterval / time.Millisecond),
	}
	row, err := srv.Queries.GetOrgPlan(ctx, ss.key.OrgID)
	if err != nil {
		srv.Logger.ErrorContext(ctx, "load plan for tunnel", "error", err)
		ss.fail(ctx, protocol.CloseGoingAway, protocol.CodeInternal, "Hookline is temporarily unavailable. Retry shortly.")
		return limits, false
	}
	plan := entitlements.Resolve(srv.PlanOverride, true, (*string)(row.Plan), (*string)(row.PlanOverride))
	if n := entitlements.For(plan).ConcurrentTunnels; n != entitlements.Unlimited {
		limits.ConcurrentTunnels = int(n)
	}
	ok, err := srv.Presence.Acquire(ctx, ss.key.OrgID, ss.id, limits.ConcurrentTunnels)
	if err != nil {
		srv.Logger.WarnContext(ctx, "tunnel limit check failed open", "error", err)
	}
	if !ok {
		ss.fail(ctx, protocol.CloseTooManyTunnels, protocol.CodeTooManyTunnels, fmt.Sprintf(
			"Your plan allows %d concurrent tunnel(s). Stop another `hookline listen` or upgrade.", limits.ConcurrentTunnels))
		return limits, false
	}
	return limits, true
}

func (ss *session) ready(limits protocol.Limits) protocol.Ready {
	base := strings.TrimRight(ss.srv.PublicURL, "/")
	r := protocol.Ready{Type: protocol.TypeReady, SessionID: ss.id, Limits: limits}
	for _, e := range ss.eps {
		r.Endpoints = append(r.Endpoints, protocol.ReadyEndpoint{
			ID: e.ID.String(), Slug: e.Slug, Name: e.Name, URL: base + "/h/" + e.Slug, ResponseMode: string(e.ResponseMode),
		})
	}
	return r
}

// finish releases the session's slot, announces the new CLI counts and
// records tunnel minutes.
func (ss *session) finish(ctx context.Context, started time.Time) {
	srv := ss.srv
	bg, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := srv.Presence.Leave(bg, ss.key.OrgID, ss.id, ss.epIDs); err != nil {
		srv.Logger.DebugContext(bg, "tunnel presence leave", "error", err)
	}
	minutes := int64(math.Ceil(srv.Now().Sub(started).Minutes()))
	if err := srv.Queries.AddTunnelMinutes(bg, dbq.AddTunnelMinutesParams{
		OrgID: ss.key.OrgID, Day: srv.Now().UTC().Truncate(24 * time.Hour), Minutes: minutes,
	}); err != nil {
		srv.Logger.WarnContext(bg, "record tunnel minutes", "error", err)
	}
}

func (ss *session) writer(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case b := <-ss.out:
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := ss.conn.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				ss.close(protocol.CloseGoingAway, "write failed")
				return
			}
		}
	}
}

// forward relays an endpoint's requests (already protocol frames) to the client.
func (ss *session) forward(ctx context.Context, sub *pubsub.Subscriber) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-sub.Done():
			if sub.Reason() == pubsub.ReasonLagging {
				ss.close(protocol.CloseLagging, "client too slow; reconnect to resume")
			}
			return
		case msg := <-sub.Events():
			if !ss.hello.Sync {
				msg = stripSyncDeadline(msg)
			}
			ss.sendRaw(msg, string(protocol.TypeRequest))
		}
	}
}

// stripSyncDeadline hides the sync deadline from observe-only clients, which
// never answer.
func stripSyncDeadline(msg []byte) []byte {
	if !strings.Contains(string(msg), `"sync_deadline_ms"`) {
		return msg
	}
	var req protocol.Request
	if protocol.Decode(msg, &req) != nil {
		return msg
	}
	req.SyncDeadlineMS = 0
	b, err := json.Marshal(req)
	if err != nil {
		return msg
	}
	return b
}

func (ss *session) keepAlive(ctx context.Context) {
	srv := ss.srv
	t := time.NewTicker(srv.PingInterval)
	defer t.Stop()
	silence := srv.PingInterval * (protocol.MissedPings + 1)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if srv.Now().Sub(time.Unix(0, ss.lastSeen.Load())) > silence {
				ss.close(protocol.ClosePingTimeout, "no ping or pong received")
				return
			}
			ss.send(protocol.Ping{Type: protocol.TypePing})
			if err := srv.Presence.Refresh(ctx, ss.key.OrgID, ss.id, ss.epIDs); err != nil {
				srv.Logger.DebugContext(ctx, "tunnel presence refresh", "error", err)
			}
		}
	}
}

func (ss *session) readLoop(ctx context.Context) {
	srv := ss.srv
	for {
		typ, data, err := ss.conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusMessageTooBig {
				ss.close(protocol.CloseMessageTooBig, "frame too large")
			}
			ss.cancel()
			return
		}
		ss.seen()
		if typ != websocket.MessageText {
			ss.send(protocol.Error{Type: protocol.TypeError, Code: protocol.CodeInvalidMessage, Message: "Frames must be JSON text messages."})
			continue
		}
		if len(data) > protocol.MaxMessageBytes {
			srv.Metrics.TunnelFrames.WithLabelValues("in", "too_large").Inc()
			ss.send(protocol.Error{Type: protocol.TypeError, Code: protocol.CodeMessageTooLarge,
				Message: fmt.Sprintf("Frames are limited to %d bytes.", protocol.MaxMessageBytes)})
			continue
		}
		t, id, err := protocol.Peek(data)
		if err != nil {
			ss.send(protocol.Error{Type: protocol.TypeError, Code: protocol.CodeInvalidMessage, Message: err.Error()})
			continue
		}
		srv.Metrics.TunnelFrames.WithLabelValues("in", string(knownType(t))).Inc()
		switch t {
		case protocol.TypePing:
			ss.send(protocol.Ping{Type: protocol.TypePong})
		case protocol.TypePong:
		case protocol.TypeResponse:
			var resp protocol.Response
			if err := protocol.Decode(data, &resp); err != nil {
				ss.send(protocol.Error{Type: protocol.TypeError, ID: id, Code: protocol.CodeInvalidMessage, Message: err.Error()})
				continue
			}
			if err := resp.Validate(); err != nil {
				ss.send(protocol.Error{Type: protocol.TypeError, ID: id, Code: protocol.CodeInvalidMessage, Message: err.Error()})
				continue
			}
			ss.publishAnswer(ctx, id, data)
		case protocol.TypeError:
			if id != "" {
				ss.publishAnswer(ctx, id, data)
			}
		default:
			// Unknown types are ignored for forward compatibility; hello
			// twice is a client bug worth reporting.
			if t == protocol.TypeHello {
				ss.send(protocol.Error{Type: protocol.TypeError, Code: protocol.CodeInvalidMessage, Message: "hello was already received."})
			}
		}
	}
}

func knownType(t protocol.Type) protocol.Type {
	switch t {
	case protocol.TypeHello, protocol.TypeResponse, protocol.TypeError, protocol.TypePing, protocol.TypePong:
		return t
	default:
		// Edge-to-client types or newer ones: one label keeps cardinality fixed.
	}
	return "unknown"
}

// publishAnswer hands a CLI's answer to whichever intake request waits for
// it. Only sessions that offered sync answers (hello.sync) are heard.
func (ss *session) publishAnswer(ctx context.Context, requestID string, frame []byte) {
	if !ss.hello.Sync {
		return
	}
	if _, err := uuid.Parse(requestID); err != nil {
		return
	}
	pctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := ss.srv.RDB.Publish(pctx, ResponseChannel(requestID), frame).Err(); err != nil {
		ss.srv.Logger.DebugContext(ctx, "publish tunnel answer", "error", err)
	}
}

// replay sends requests the client missed while reconnecting.
func (ss *session) replay(ctx context.Context) {
	if ss.hello.LastRequestID == "" {
		return
	}
	after, err := uuid.Parse(ss.hello.LastRequestID)
	if err != nil {
		return
	}
	srv := ss.srv
	sec, nsec := after.Time().UnixTime()
	since := time.Unix(sec, nsec).Add(-time.Minute)
	if floor := srv.Now().Add(-protocol.ReplayWindow); since.Before(floor) {
		since = floor
	}
	rows, err := srv.Queries.ListTunnelReplay(ctx, dbq.ListTunnelReplayParams{
		EndpointIds: ss.epIDs, Since: since, AfterID: after, MaxRows: protocol.ReplayLimit,
	})
	if err != nil {
		srv.Logger.WarnContext(ctx, "tunnel replay", "error", err)
		return
	}
	for _, row := range rows {
		body := row.BodyInline
		if row.BodyS3Key != nil && srv.Blobs != nil && int(row.BodySize) <= maxInlineBody {
			if rc, err := srv.Blobs.Get(ctx, *row.BodyS3Key); err == nil {
				body, _ = io.ReadAll(io.LimitReader(rc, maxInlineBody))
				_ = rc.Close()
			}
		}
		var headers, query []protocol.Header
		_ = json.Unmarshal(row.Headers, &headers)
		_ = json.Unmarshal(row.Query, &query)
		req := NewRequest(row.ID, row.EndpointID, row.Method, row.Path, encodeQuery(query), headers, body, row.ReceivedAt)
		if row.BodyS3Key != nil && len(body) == 0 {
			req.BodyOmitted = true
		}
		req.BodySize = int(row.BodySize)
		req.Replayed = true
		ss.send(req)
	}
}

// encodeQuery rebuilds a query string from stored pairs, keeping their order.
func encodeQuery(pairs []protocol.Header) string {
	parts := make([]string, 0, len(pairs))
	for _, p := range pairs {
		parts = append(parts, url.QueryEscape(p[0])+"="+url.QueryEscape(p[1]))
	}
	return strings.Join(parts, "&")
}
