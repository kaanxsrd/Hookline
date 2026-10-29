// Package ui formats CLI output: one colored line per request, status
// messages on stderr, and JSON lines for scripts.
package ui

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/kaanxsrd/hookline/packages/protocol"
)

// Printer writes CLI output. It is safe for concurrent use.
type Printer struct {
	out, err io.Writer
	JSON     bool
	mu       sync.Mutex

	dim, bold, ok, warn, bad, info lipgloss.Style
}

// New returns a Printer. Colors follow the terminal unless noColor is set
// (NO_COLOR is honored by the renderer too).
func New(out, errw io.Writer, noColor, jsonOutput bool) *Printer {
	r := lipgloss.NewRenderer(out)
	if noColor {
		r.SetColorProfile(termenv.Ascii)
	}
	return &Printer{
		out: out, err: errw, JSON: jsonOutput,
		dim:  r.NewStyle().Faint(true),
		bold: r.NewStyle().Bold(true),
		ok:   r.NewStyle().Foreground(lipgloss.Color("2")),
		warn: r.NewStyle().Foreground(lipgloss.Color("3")),
		bad:  r.NewStyle().Foreground(lipgloss.Color("1")),
		info: r.NewStyle().Foreground(lipgloss.Color("6")),
	}
}

// Out is the standard output writer.
func (p *Printer) Out() io.Writer { return p.out }

func (p *Printer) line(w io.Writer, s string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, _ = fmt.Fprintln(w, s)
}

// Println writes a plain line to stdout.
func (p *Printer) Println(s string) { p.line(p.out, s) }

// Status writes a dimmed progress message to stderr.
func (p *Printer) Status(format string, args ...any) {
	p.line(p.err, p.dim.Render(fmt.Sprintf(format, args...)))
}

// Success writes a green message to stderr.
func (p *Printer) Success(format string, args ...any) {
	p.line(p.err, p.ok.Render("✓ ")+fmt.Sprintf(format, args...))
}

// Warn writes a yellow message to stderr.
func (p *Printer) Warn(format string, args ...any) {
	p.line(p.err, p.warn.Render("! ")+fmt.Sprintf(format, args...))
}

// Bold renders s in bold.
func (p *Printer) Bold(s string) string { return p.bold.Render(s) }

// Info renders s in the accent color.
func (p *Printer) Info(s string) string { return p.info.Render(s) }

// JSONLine writes v as one line of JSON to stdout.
func (p *Printer) JSONLine(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	p.line(p.out, string(b))
}

func (p *Printer) status(code int) string {
	s := strconv.Itoa(code)
	switch {
	case code >= 500:
		return p.bad.Render(s)
	case code >= 400:
		return p.warn.Render(s)
	default:
		return p.ok.Render(s)
	}
}

// Forwarded prints "12:04:31  POST /h/abc/stripe  → 200  38 ms  evt_1Px…".
func (p *Printer) Forwarded(slug string, req protocol.Request, resp *protocol.Response, perr *protocol.Error, d time.Duration) {
	if p.JSON {
		v := map[string]any{"request": jsonRequest(slug, req), "duration_ms": d.Milliseconds()}
		if resp != nil {
			v["status"] = resp.Status
		}
		if perr != nil {
			v["error"] = map[string]string{"code": perr.Code, "message": perr.Message}
		}
		p.JSONLine(v)
		return
	}
	result := ""
	switch {
	case perr != nil:
		result = p.bad.Render("✗ " + perr.Message)
	case resp != nil:
		result = "→ " + p.status(resp.Status) + "  " + p.dim.Render(fmt.Sprintf("%d ms", d.Milliseconds()))
	}
	p.Println(strings.TrimRight(p.prefix(slug, req)+"  "+result+"  "+p.dim.Render(Hint(req)), " "))
}

// Observed prints a request without forwarding (tail).
func (p *Printer) Observed(slug string, req protocol.Request) {
	if p.JSON {
		p.JSONLine(jsonRequest(slug, req))
		return
	}
	size := fmt.Sprintf("%d B", req.BodySize)
	p.Println(strings.TrimRight(p.prefix(slug, req)+"  "+p.dim.Render(size)+"  "+p.dim.Render(Hint(req)), " "))
}

func (p *Printer) prefix(slug string, req protocol.Request) string {
	path := "/h/" + slug + strings.TrimSuffix(req.Path, "/")
	if req.Query != "" {
		path += "?" + req.Query
	}
	when := req.ReceivedAt.Local().Format("15:04:05")
	marker := ""
	switch {
	case req.ReplayOf != "":
		marker = p.info.Render(" (replay)")
	case req.Replayed:
		marker = p.dim.Render(" (missed while reconnecting)")
	}
	return p.dim.Render(when) + "  " + p.bold.Render(fmt.Sprintf("%-6s", req.Method)) + " " + path + marker
}

// Hint is a short identifier of what the request is about: the event type or
// ID that webhook providers put in headers or the JSON body.
func Hint(req protocol.Request) string {
	for _, h := range req.Headers {
		switch strings.ToLower(h[0]) {
		case "x-github-event", "x-shopify-topic", "x-event-key", "x-hook-event":
			return h[1]
		}
	}
	if !strings.Contains(strings.ToLower(contentType(req)), "json") {
		return ""
	}
	body, err := base64.StdEncoding.DecodeString(req.BodyB64)
	if err != nil {
		return ""
	}
	var doc map[string]any
	if json.Unmarshal(body, &doc) != nil {
		return ""
	}
	for _, key := range []string{"type", "event", "event_type", "id"} {
		if s, ok := doc[key].(string); ok && s != "" {
			if len(s) > 40 {
				s = s[:39] + "…"
			}
			return s
		}
	}
	return ""
}

func contentType(req protocol.Request) string {
	for _, h := range req.Headers {
		if strings.EqualFold(h[0], "Content-Type") {
			return h[1]
		}
	}
	return ""
}

// jsonRequest is the --json shape of a request: the body as text when it is
// UTF-8, otherwise base64.
func jsonRequest(slug string, req protocol.Request) map[string]any {
	v := map[string]any{
		"id":          req.ID,
		"endpoint":    slug,
		"method":      req.Method,
		"path":        req.Path,
		"query":       req.Query,
		"headers":     req.Headers,
		"received_at": req.ReceivedAt,
		"body_size":   req.BodySize,
	}
	if body, err := base64.StdEncoding.DecodeString(req.BodyB64); err == nil && utf8.Valid(body) {
		v["body"] = string(body)
	} else {
		v["body_b64"] = req.BodyB64
	}
	if req.BodyOmitted {
		v["body_omitted"] = true
	}
	return v
}
