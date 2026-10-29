// Package tunnel is the client side of the Hookline tunnel protocol
// (hookline.v1, docs/tunnel-protocol.md). It keeps a session open, hands
// each captured request to a Handler, sends the answers back, and reconnects
// with backoff, resuming after the last request it saw.
//
// It is importable so other Go programs (and the edge's end-to-end tests)
// can embed a tunnel.
package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/kaanxsrd/hookline/packages/protocol"
)

// Handler answers one request. Returning (nil, nil) sends nothing (the
// request is only observed); a non-nil *protocol.Error is sent instead of a
// response.
type Handler func(ctx context.Context, req protocol.Request) (*protocol.Response, *protocol.Error)

// EventKind classifies connection events.
type EventKind int

// Connection events reported to OnEvent.
const (
	EventConnecting   EventKind = iota // dialing (Attempt counts from 1)
	EventReady                         // the session is open (Ready is set)
	EventDisconnected                  // the session ended; reconnecting after Delay
	EventServerError                   // the edge sent an error frame (Message)
	EventGoAway                        // the edge is restarting; reconnecting after Delay
)

// Event describes a connection state change.
type Event struct {
	Kind    EventKind
	Attempt int
	Delay   time.Duration
	Ready   *protocol.Ready
	Err     error
	Code    string
	Message string
}

// FatalError ends Run: retrying cannot help (bad key, unknown endpoint,
// unsupported protocol).
type FatalError struct {
	Status  int    // HTTP status of a rejected handshake, if any
	Close   int    // WebSocket close code, if any
	Code    string // error frame code, if any
	Message string
}

func (e *FatalError) Error() string { return e.Message }

// Client is a reconnecting tunnel.
type Client struct {
	// URL is the edge's tunnel URL, e.g. wss://hookline.example.com/v1/tunnel.
	URL        string
	APIKey     string
	Endpoints  []string
	Sync       bool
	CLIVersion string

	// Handler answers requests; nil only observes them.
	Handler Handler
	// OnRequest is called for every request before it is handled.
	OnRequest func(protocol.Request)
	// OnAnswer is called after the handler returns, with what was sent.
	OnAnswer func(req protocol.Request, resp *protocol.Response, perr *protocol.Error, d time.Duration)
	// OnEvent reports connection changes.
	OnEvent func(Event)

	// HTTPClient performs the handshake; nil uses http.DefaultClient.
	HTTPClient *http.Client
	// MinBackoff and MaxBackoff bound reconnect delays (default 1 s and 30 s).
	MinBackoff, MaxBackoff time.Duration
	// Concurrency bounds requests handled at once (default 16).
	Concurrency int
	// PingInterval defaults to protocol.PingInterval.
	PingInterval time.Duration

	lastID atomic.Value // string: newest request ID seen, for resuming
	seen   *recentSet
}

// LastRequestID is the newest request seen, sent as hello.last_request_id on reconnect.
func (c *Client) LastRequestID() string {
	v, _ := c.lastID.Load().(string)
	return v
}

func (c *Client) emit(e Event) {
	if c.OnEvent != nil {
		c.OnEvent(e)
	}
}

// Run keeps the tunnel open until ctx ends (it then returns nil) or a fatal
// error occurs.
func (c *Client) Run(ctx context.Context) error {
	if c.MinBackoff <= 0 {
		c.MinBackoff = time.Second
	}
	if c.MaxBackoff <= 0 {
		c.MaxBackoff = 30 * time.Second
	}
	if c.Concurrency <= 0 {
		c.Concurrency = 16
	}
	if c.PingInterval <= 0 {
		c.PingInterval = protocol.PingInterval
	}
	if c.seen == nil {
		c.seen = newRecentSet(2048)
	}

	attempt := 0
	for {
		attempt++
		c.emit(Event{Kind: EventConnecting, Attempt: attempt})
		readyAt, delay, err := c.session(ctx)
		if ctx.Err() != nil {
			return nil //nolint:nilerr // cancellation is a clean stop, whatever the session reported
		}
		var fatal *FatalError
		if errors.As(err, &fatal) {
			return fatal
		}
		if !readyAt.IsZero() {
			attempt = 1 // a session was established; start the backoff over
		}
		if delay < 0 {
			delay = backoff(attempt, c.MinBackoff, c.MaxBackoff)
		}
		c.emit(Event{Kind: EventDisconnected, Attempt: attempt, Delay: delay, Err: err})
		t := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			t.Stop()
			return nil
		case <-t.C:
		}
	}
}

// backoff is full jitter: uniform in [min, min·2^(attempt-1)], capped.
func backoff(attempt int, lo, hi time.Duration) time.Duration {
	ceiling := lo << min(attempt-1, 20)
	if ceiling > hi || ceiling <= 0 {
		ceiling = hi
	}
	return lo + time.Duration(rand.Int64N(int64(ceiling-lo)+1)) //nolint:gosec // jitter, not security
}

// session runs one connection. It returns when the connection had been
// ready (zero time otherwise), the delay requested by goaway (-1 for normal
// backoff) and why it ended.
func (c *Client) session(ctx context.Context) (time.Time, time.Duration, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	hdr := http.Header{}
	hdr.Set("Authorization", "Bearer "+c.APIKey)
	hdr.Set("User-Agent", "hookline-cli/"+c.CLIVersion)
	dctx, dcancel := context.WithTimeout(ctx, 15*time.Second)
	conn, resp, err := websocket.Dial(dctx, c.URL, &websocket.DialOptions{
		HTTPClient:   c.HTTPClient,
		HTTPHeader:   hdr,
		Subprotocols: []string{protocol.Subprotocol},
	})
	dcancel()
	if err != nil {
		return time.Time{}, -1, handshakeError(resp, err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(protocol.HardMessageBytes)

	var wmu sync.Mutex
	write := func(v any) error {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		wmu.Lock()
		defer wmu.Unlock()
		wctx, wcancel := context.WithTimeout(ctx, 10*time.Second)
		defer wcancel()
		return conn.Write(wctx, websocket.MessageText, b)
	}

	if err := write(protocol.Hello{
		Type: protocol.TypeHello, Protocol: protocol.Version, CLIVersion: c.CLIVersion,
		Endpoints: c.Endpoints, Sync: c.Sync, LastRequestID: c.LastRequestID(),
	}); err != nil {
		return time.Time{}, -1, err
	}

	var lastFrame atomic.Int64
	lastFrame.Store(time.Now().UnixNano())
	var readyAt time.Time
	var serverErr *protocol.Error
	sem := make(chan struct{}, c.Concurrency)
	var handlers sync.WaitGroup
	// Stop in-flight handlers before the connection closes.
	defer func() {
		cancel()
		handlers.Wait()
	}()

	go func() {
		t := time.NewTicker(c.PingInterval)
		defer t.Stop()
		silence := c.PingInterval * (protocol.MissedPings + 1)
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if time.Since(time.Unix(0, lastFrame.Load())) > silence {
					_ = conn.Close(protocol.ClosePingTimeout, "no frames from the edge")
					cancel()
					return
				}
				_ = write(protocol.Ping{Type: protocol.TypePing})
			}
		}
	}()

	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return readyAt, -1, c.closeError(err, serverErr, readyAt)
		}
		lastFrame.Store(time.Now().UnixNano())
		if typ != websocket.MessageText {
			continue
		}
		t, _, err := protocol.Peek(data)
		if err != nil {
			continue
		}
		switch t {
		case protocol.TypeReady:
			var r protocol.Ready
			if protocol.Decode(data, &r) == nil {
				readyAt = time.Now()
				c.emit(Event{Kind: EventReady, Ready: &r})
			}
		case protocol.TypePing:
			_ = write(protocol.Ping{Type: protocol.TypePong})
		case protocol.TypePong:
		case protocol.TypeGoAway:
			var g protocol.GoAway
			_ = protocol.Decode(data, &g)
			delay := time.Duration(g.ReconnectAfterMS) * time.Millisecond
			c.emit(Event{Kind: EventGoAway, Delay: delay, Message: g.Reason})
			_ = conn.Close(websocket.StatusNormalClosure, "goaway")
			return readyAt, delay, errors.New("the edge is restarting")
		case protocol.TypeError:
			var e protocol.Error
			if protocol.Decode(data, &e) == nil {
				serverErr = &e
				c.emit(Event{Kind: EventServerError, Code: e.Code, Message: e.Message})
			}
		case protocol.TypeRequest:
			var req protocol.Request
			if protocol.Decode(data, &req) != nil || req.ID == "" {
				continue
			}
			if !c.seen.add(req.ID) {
				continue // replayed and live copies of the same request
			}
			if req.ID > c.LastRequestID() { // UUIDv7 strings sort by time
				c.lastID.Store(req.ID)
			}
			if c.OnRequest != nil {
				c.OnRequest(req)
			}
			if c.Handler == nil {
				continue
			}
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return readyAt, -1, ctx.Err()
			}
			handlers.Go(func() {
				defer func() { <-sem }()
				c.handle(ctx, req, write)
			})
		default:
			// hello and response only travel to the edge; unknown types are
			// ignored for forward compatibility.
		}
	}
}

func (c *Client) handle(ctx context.Context, req protocol.Request, write func(any) error) {
	start := time.Now()
	resp, perr := c.Handler(ctx, req)
	elapsed := time.Since(start)
	if c.OnAnswer != nil {
		c.OnAnswer(req, resp, perr, elapsed)
	}
	switch {
	case perr != nil:
		perr.Type = protocol.TypeError
		perr.ID = req.ID
		_ = write(perr)
	case resp != nil:
		resp.Type = protocol.TypeResponse
		resp.ID = req.ID
		if resp.DurationMS == 0 {
			resp.DurationMS = float64(elapsed.Microseconds()) / 1000
		}
		_ = write(resp)
	}
}

// handshakeError turns a failed dial into a fatal error when retrying cannot help.
func handshakeError(resp *http.Response, err error) error {
	if resp == nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	_ = json.Unmarshal(raw, &body)
	msg := body.Error.Message
	if msg == "" {
		msg = strings.TrimSpace(string(raw))
	}
	if msg == "" {
		msg = resp.Status
	}
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
		return &FatalError{Status: resp.StatusCode, Code: body.Error.Code, Message: msg}
	}
	return fmt.Errorf("tunnel handshake: %s", msg)
}

func (c *Client) closeError(err error, serverErr *protocol.Error, readyAt time.Time) error {
	code := int(websocket.CloseStatus(err))
	if code > 0 && !protocol.Retryable(code) {
		msg := fmt.Sprintf("the edge closed the tunnel (%d)", code)
		fe := &FatalError{Close: code, Message: msg}
		if serverErr != nil {
			fe.Code, fe.Message = serverErr.Code, serverErr.Message
		}
		return fe
	}
	if code == protocol.CloseTooManyTunnels && readyAt.IsZero() && serverErr != nil {
		return fmt.Errorf("%s", serverErr.Message)
	}
	return err
}

// recentSet remembers the last n IDs.
type recentSet struct {
	mu    sync.Mutex
	order []string
	set   map[string]struct{}
	n     int
}

func newRecentSet(n int) *recentSet {
	return &recentSet{set: make(map[string]struct{}, n), n: n}
}

// add reports whether id is new.
func (r *recentSet) add(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.set[id]; ok {
		return false
	}
	r.set[id] = struct{}{}
	r.order = append(r.order, id)
	if len(r.order) > r.n {
		delete(r.set, r.order[0])
		r.order = r.order[1:]
	}
	return true
}
