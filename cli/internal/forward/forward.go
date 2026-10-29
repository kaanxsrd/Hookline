// Package forward sends tunnelled requests to a local target and turns the
// answer into a protocol response.
package forward

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/kaanxsrd/hookline/packages/protocol"
)

// MaxResponseBody is the largest local response body sent back; it keeps
// response frames under protocol.MaxMessageBytes.
const MaxResponseBody = 512 << 10

// DefaultTimeout applies when the request carries no sync deadline.
const DefaultTimeout = 30 * time.Second

// Rewrite replaces a path prefix.
type Rewrite struct{ From, To string }

// ParseRewrite reads "/from=/to".
func ParseRewrite(s string) (Rewrite, error) {
	from, to, ok := strings.Cut(s, "=")
	if !ok || !strings.HasPrefix(from, "/") || (to != "" && !strings.HasPrefix(to, "/")) {
		return Rewrite{}, fmt.Errorf("path rewrite %q must look like /from=/to", s)
	}
	return Rewrite{From: from, To: to}, nil
}

// ParseHeader reads "Name: value" or "Name:value".
func ParseHeader(s string) ([2]string, error) {
	name, value, ok := strings.Cut(s, ":")
	name = strings.TrimSpace(name)
	if !ok || name == "" || strings.ContainsAny(name, " \t\r\n") || strings.ContainsAny(value, "\r\n") {
		return [2]string{}, fmt.Errorf("header %q must look like Name:value", s)
	}
	return [2]string{name, strings.TrimSpace(value)}, nil
}

// Forwarder delivers requests to Target.
type Forwarder struct {
	Target   *url.URL
	Rewrites []Rewrite
	// Headers are set on every forwarded request (replacing captured ones).
	Headers [][2]string
	Client  *http.Client
}

// New returns a Forwarder for target ("http://localhost:3000/api/webhooks").
func New(target string, rewrites []Rewrite, headers [][2]string) (*Forwarder, error) {
	u, err := url.Parse(target)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("--forward must be an http(s) URL such as http://localhost:3000/webhooks, got %q", target)
	}
	return &Forwarder{
		Target:   u,
		Rewrites: rewrites,
		Headers:  headers,
		Client: &http.Client{
			// Redirects are answered as they are; the sender sees them in sync mode.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
			Transport:     &http.Transport{Proxy: nil, MaxIdleConnsPerHost: 16, IdleConnTimeout: 90 * time.Second},
		},
	}, nil
}

// hopByHop headers describe the captured connection, not the request.
var hopByHop = map[string]bool{
	"connection": true, "keep-alive": true, "proxy-authenticate": true, "proxy-authorization": true,
	"te": true, "trailer": true, "transfer-encoding": true, "upgrade": true, "host": true,
	"content-length": true, "accept-encoding": true,
}

// URL is where req is sent: the target path plus the (rewritten) path below
// /h/{slug}, and the target's query plus the captured one.
func (f *Forwarder) URL(req protocol.Request) *url.URL {
	u := *f.Target
	p := req.Path
	for _, rw := range f.Rewrites {
		if rest, ok := strings.CutPrefix(p, rw.From); ok && (rest == "" || strings.HasPrefix(rest, "/") || strings.HasSuffix(rw.From, "/")) {
			p = rw.To + rest
			break
		}
	}
	if p != "" && p != "/" {
		u.Path = strings.TrimSuffix(u.Path, "/") + p
		u.RawPath = ""
	}
	switch {
	case u.RawQuery == "":
		u.RawQuery = req.Query
	case req.Query != "":
		u.RawQuery += "&" + req.Query
	}
	return &u
}

// Handle forwards req and returns the local answer or an error frame.
func (f *Forwarder) Handle(ctx context.Context, req protocol.Request) (*protocol.Response, *protocol.Error) {
	timeout := DefaultTimeout
	if req.SyncDeadlineMS > 0 {
		timeout = time.Duration(req.SyncDeadlineMS) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	body, err := base64.StdEncoding.DecodeString(req.BodyB64)
	if err != nil {
		return nil, &protocol.Error{Code: protocol.CodeInvalidMessage, Message: "request body is not valid base64"}
	}
	target := f.URL(req)
	out, err := http.NewRequestWithContext(ctx, req.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		return nil, &protocol.Error{Code: protocol.CodeInvalidMessage, Message: err.Error()}
	}
	for _, h := range req.Headers {
		if !hopByHop[strings.ToLower(h[0])] {
			out.Header.Add(h[0], h[1])
		}
	}
	for _, h := range f.Headers {
		out.Header.Set(h[0], h[1])
	}
	out.Header.Set("X-Hookline-Request-Id", req.ID)

	start := time.Now()
	resp, err := f.Client.Do(out)
	if err != nil {
		return nil, classify(err, target, timeout)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBody))
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, classify(err, target, timeout)
	}
	headers := make([]protocol.Header, 0, len(resp.Header))
	for name, values := range resp.Header {
		if hopByHop[strings.ToLower(name)] {
			continue
		}
		for _, v := range values {
			headers = append(headers, protocol.Header{name, v})
		}
	}
	slices.SortStableFunc(headers, func(a, b protocol.Header) int { return strings.Compare(a[0], b[0]) })
	return &protocol.Response{
		Status:     resp.StatusCode,
		Headers:    headers,
		BodyB64:    base64.StdEncoding.EncodeToString(data),
		DurationMS: float64(time.Since(start).Microseconds()) / 1000,
	}, nil
}

func classify(err error, target *url.URL, timeout time.Duration) *protocol.Error {
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, os.ErrDeadlineExceeded):
		return &protocol.Error{Code: protocol.CodeTimeout, Message: fmt.Sprintf("%s did not answer within %s", target.Host, timeout)}
	case errors.Is(err, syscall.ECONNREFUSED) || isWinConnRefused(err):
		return &protocol.Error{Code: protocol.CodeTargetUnreachable, Message: fmt.Sprintf("connection refused: is your server running on %s?", target.Host)}
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return &protocol.Error{Code: protocol.CodeTargetUnreachable, Message: "cannot resolve " + dnsErr.Name}
	}
	return &protocol.Error{Code: protocol.CodeTargetUnreachable, Message: err.Error()}
}

// isWinConnRefused matches WSAECONNREFUSED, which syscall.ECONNREFUSED does not on Windows.
func isWinConnRefused(err error) bool {
	var errno syscall.Errno
	return errors.As(err, &errno) && errno == 10061
}
