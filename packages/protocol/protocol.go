// Package protocol defines the Hookline tunnel protocol, version 1
// (WebSocket subprotocol "hookline.v1"), shared by the edge and the CLI.
//
// docs/tunnel-protocol.md is the specification; packages/shared/src/tunnel.ts
// mirrors these types for TypeScript. Every frame is one JSON text message
// with a "type" field. Receivers ignore fields they do not know, so additions
// never break older peers; incompatible changes bump Version.
package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const (
	// Subprotocol is negotiated in Sec-WebSocket-Protocol.
	Subprotocol = "hookline.v1"
	// Version is sent in hello.protocol. An edge that receives a higher
	// version answers with an unsupported_protocol error and closes.
	Version = 1
	// Path is where the edge serves tunnels.
	Path = "/v1/tunnel"

	// MaxMessageBytes is the largest frame either side accepts. Larger
	// frames are answered with a message_too_large error frame.
	MaxMessageBytes = 1 << 20
	// HardMessageBytes is where a peer stops reading and closes with
	// CloseMessageTooBig instead of answering.
	HardMessageBytes = 4 << 20

	// PingInterval is how often each side sends ping. A peer that has sent
	// nothing for MissedPings+1 intervals is dropped.
	PingInterval = 20 * time.Second
	// MissedPings is how many pings may go unanswered.
	MissedPings = 2
	// HelloTimeout bounds the wait for the client's hello.
	HelloTimeout = 10 * time.Second
	// MaxEndpoints is how many endpoints one session may listen on.
	MaxEndpoints = 10
	// ReplayLimit caps the requests replayed after hello.last_request_id.
	ReplayLimit = 100
	// ReplayWindow bounds how far back a resuming client is caught up.
	ReplayWindow = 10 * time.Minute
)

// Type identifies a frame.
type Type string

// Frame types.
const (
	TypeHello    Type = "hello"    // CLI → edge
	TypeReady    Type = "ready"    // edge → CLI
	TypeRequest  Type = "request"  // edge → CLI
	TypeResponse Type = "response" // CLI → edge
	TypeError    Type = "error"    // both
	TypePing     Type = "ping"     // both
	TypePong     Type = "pong"     // both
	TypeGoAway   Type = "goaway"   // edge → CLI
)

// Error codes carried by error frames.
const (
	CodeTargetUnreachable   = "target_unreachable"   // CLI: the local target refused or failed
	CodeTimeout             = "timeout"              // CLI: the local target did not answer in time
	CodeMessageTooLarge     = "message_too_large"    // a frame exceeded MaxMessageBytes
	CodeInvalidMessage      = "invalid_message"      // malformed JSON or missing fields
	CodeUnsupportedProtocol = "unsupported_protocol" // hello.protocol is newer than the edge
	CodeUnknownEndpoint     = "unknown_endpoint"     // a slug that does not exist in the key's organization
	CodeTooManyTunnels      = "too_many_tunnels"     // the plan's concurrent tunnel limit is reached
	CodeInternal            = "internal"             // an unexpected server error
)

// WebSocket close codes. 4000–4999 are reserved for applications.
const (
	CloseNormal              = 1000 // the CLI quit
	CloseGoingAway           = 1001 // the edge is restarting; reconnect (after goaway)
	CloseMessageTooBig       = 1009 // a frame exceeded HardMessageBytes
	CloseInvalidMessage      = 4000 // protocol violation; do not retry unchanged
	CloseUnauthorized        = 4001 // the API key was revoked; do not retry
	CloseUnknownEndpoint     = 4004 // do not retry
	CloseTooManyTunnels      = 4008 // retry later
	CloseUnsupportedProtocol = 4010 // upgrade the CLI
	ClosePingTimeout         = 4011 // the peer went silent; reconnect
	CloseLagging             = 4029 // the client read too slowly; reconnect (and resume)
)

// Retryable reports whether a client should reconnect after the edge closed
// the socket with code.
func Retryable(code int) bool {
	switch code {
	case CloseInvalidMessage, CloseUnauthorized, CloseUnknownEndpoint, CloseUnsupportedProtocol:
		return false
	default:
		return true
	}
}

// Header is one header line; order and repeats are significant.
type Header = [2]string

// Hello opens a session.
type Hello struct {
	Type       Type     `json:"type"`
	Protocol   int      `json:"protocol"`
	CLIVersion string   `json:"cli_version"`
	Endpoints  []string `json:"endpoints"` // slugs
	// Sync offers this client's responses to endpoints in CLI sync mode.
	// Clients that only observe (tail) send false.
	Sync bool `json:"sync"`
	// LastRequestID resumes after a reconnect: newer requests (at most
	// ReplayLimit, within ReplayWindow) are sent before live ones, marked replayed.
	LastRequestID string `json:"last_request_id,omitempty"`
}

// ReadyEndpoint describes one endpoint of the session.
type ReadyEndpoint struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	URL          string `json:"url"`
	Name         string `json:"name"`
	ResponseMode string `json:"response_mode"` // "static" or "cli_sync"
}

// Limits tell the client what the edge enforces.
type Limits struct {
	MaxMessageBytes   int `json:"max_message_bytes"`
	PingIntervalMS    int `json:"ping_interval_ms"`
	ConcurrentTunnels int `json:"concurrent_tunnels"` // 0 means unlimited
}

// Ready acknowledges hello.
type Ready struct {
	Type      Type            `json:"type"`
	SessionID string          `json:"session_id"`
	Endpoints []ReadyEndpoint `json:"endpoints"`
	Limits    Limits          `json:"limits"`
}

// Request is a captured request delivered to the client.
type Request struct {
	Type       Type      `json:"type"`
	ID         string    `json:"id"`
	EndpointID string    `json:"endpoint_id"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`  // below /h/{slug}, always starting with "/"
	Query      string    `json:"query"` // raw query string without "?"
	Headers    []Header  `json:"headers"`
	BodyB64    string    `json:"body_b64"`
	BodySize   int       `json:"body_size"`
	ReceivedAt time.Time `json:"received_at"`
	// BodyOmitted is set when the body was too large to fit in a frame
	// (BodySize is its real size); the client forwards the request without it.
	BodyOmitted bool `json:"body_omitted,omitempty"`
	// SyncDeadlineMS is set when the sender is waiting for a response;
	// answers after the deadline are ignored.
	SyncDeadlineMS int `json:"sync_deadline_ms,omitempty"`
	// Replayed marks requests caught up after a reconnect.
	Replayed bool `json:"replayed,omitempty"`
	// ReplayOf is set when a captured request is sent again from the
	// dashboard or API; ID is then new, so clients do not de-duplicate it.
	ReplayOf string `json:"replay_of,omitempty"`
}

// Response is the local target's answer to a request.
type Response struct {
	Type       Type     `json:"type"`
	ID         string   `json:"id"`
	Status     int      `json:"status"`
	Headers    []Header `json:"headers"`
	BodyB64    string   `json:"body_b64"`
	DurationMS float64  `json:"duration_ms"`
}

// Error reports a failure. ID refers to the request it concerns, if any.
type Error struct {
	Type    Type   `json:"type"`
	ID      string `json:"id,omitempty"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Ping is both ping and pong (Type tells which).
type Ping struct {
	Type Type `json:"type"`
}

// GoAway announces that the edge is about to close the socket for a deploy.
type GoAway struct {
	Type             Type   `json:"type"`
	Reason           string `json:"reason"`
	ReconnectAfterMS int    `json:"reconnect_after_ms"`
}

// ErrTooLarge is returned for frames over MaxMessageBytes.
var ErrTooLarge = errors.New("message too large")

type envelope struct {
	Type Type   `json:"type"`
	ID   string `json:"id"`
}

// Peek returns a frame's type and ID without decoding the rest.
func Peek(data []byte) (Type, string, error) {
	if len(data) > MaxMessageBytes {
		return "", "", ErrTooLarge
	}
	var e envelope
	if err := json.Unmarshal(data, &e); err != nil {
		return "", "", fmt.Errorf("invalid frame: %w", err)
	}
	if e.Type == "" {
		return "", "", errors.New("invalid frame: missing type")
	}
	return e.Type, e.ID, nil
}

// Decode unmarshals a frame into v; unknown fields are ignored.
func Decode(data []byte, v any) error {
	if len(data) > MaxMessageBytes {
		return ErrTooLarge
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("invalid frame: %w", err)
	}
	return nil
}

// Validate checks a hello before the edge acts on it.
func (h Hello) Validate() error {
	if h.Protocol < 1 {
		return errors.New("hello.protocol must be at least 1")
	}
	if len(h.Endpoints) == 0 {
		return errors.New("hello.endpoints must name at least one endpoint")
	}
	if len(h.Endpoints) > MaxEndpoints {
		return fmt.Errorf("a session can listen on at most %d endpoints", MaxEndpoints)
	}
	return nil
}

// Validate checks a response frame.
func (r Response) Validate() error {
	if r.ID == "" {
		return errors.New("response.id is required")
	}
	if r.Status < 100 || r.Status > 599 {
		return fmt.Errorf("response.status %d is not an HTTP status", r.Status)
	}
	return nil
}
