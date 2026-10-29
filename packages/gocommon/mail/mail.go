// Package mail sends the worker's notification emails over SMTP. The
// templates are rendered from React Email (apps/web/emails) into Go
// templates by `bun run gen`, so the dashboard and the worker send the same
// designs.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	htmltemplate "html/template"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"net/url"
	"strings"
	texttemplate "text/template"
	"time"
)

//go:embed templates/*.html templates/*.txt
var templates embed.FS

// Message is one email.
type Message struct {
	To       []string
	Subject  string
	Template string // file name without extension, e.g. "delivery_failing"
	Data     any
}

// Sender delivers messages.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// Render produces the HTML and plain-text bodies of a template. Values are
// escaped for their context (HTML text, attributes, URLs).
func Render(name string, data any) (string, string, error) {
	h, err := htmltemplate.ParseFS(templates, "templates/"+name+".html")
	if err != nil {
		return "", "", err
	}
	t, err := texttemplate.ParseFS(templates, "templates/"+name+".txt")
	if err != nil {
		return "", "", err
	}
	var html, text bytes.Buffer
	if err := h.Execute(&html, data); err != nil {
		return "", "", err
	}
	if err := t.Execute(&text, data); err != nil {
		return "", "", err
	}
	return html.String(), text.String(), nil
}

// SMTP sends through a server given as smtp://[user:pass@]host[:port]
// (STARTTLS when offered) or smtps:// (implicit TLS).
type SMTP struct {
	url  *url.URL
	from *mail.Address
}

// NewSMTP parses the server URL and the From address ("Name <addr>").
func NewSMTP(rawURL, from string) (*SMTP, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "smtp" && u.Scheme != "smtps") || u.Hostname() == "" {
		return nil, fmt.Errorf("SMTP_URL must look like smtp://host:port or smtps://user:pass@host:465, got %q", rawURL)
	}
	addr, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("MAIL_FROM: %w", err)
	}
	return &SMTP{url: u, from: addr}, nil
}

// Build renders m into a MIME message (multipart/alternative, text then HTML).
func Build(from *mail.Address, m Message, now time.Time) ([]byte, error) {
	html, text, err := Render(m.Template, m.Data)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	id := make([]byte, 12)
	_, _ = rand.Read(id)
	domain := from.Address[strings.LastIndex(from.Address, "@")+1:]
	header := []string{
		"From: " + from.String(),
		"To: " + strings.Join(m.To, ", "),
		"Subject: " + mime.QEncoding.Encode("utf-8", m.Subject),
		"Date: " + now.Format(time.RFC1123Z),
		"Message-ID: <" + hex.EncodeToString(id) + "@" + domain + ">",
		"MIME-Version: 1.0",
		"Content-Type: multipart/alternative; boundary=" + w.Boundary(),
		"Auto-Submitted: auto-generated",
	}
	var out bytes.Buffer
	out.WriteString(strings.Join(header, "\r\n") + "\r\n\r\n")
	for _, part := range []struct{ typ, body string }{{"text/plain", text}, {"text/html", html}} {
		pw, err := w.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.typ + "; charset=utf-8"},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, err
		}
		qp := quotedprintable.NewWriter(pw)
		if _, err := qp.Write([]byte(part.body)); err != nil {
			return nil, err
		}
		if err := qp.Close(); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	out.Write(buf.Bytes())
	return out.Bytes(), nil
}

// Send delivers m.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	if len(m.To) == 0 {
		return errors.New("mail: no recipients")
	}
	msg, err := Build(s.from, m, time.Now())
	if err != nil {
		return err
	}
	host := s.url.Hostname()
	port := s.url.Port()
	if port == "" {
		port = map[string]string{"smtp": "587", "smtps": "465"}[s.url.Scheme]
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	dialer := &net.Dialer{}
	var conn net.Conn
	if s.url.Scheme == "smtps" {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}}).DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	}
	if err != nil {
		return fmt.Errorf("mail: connect: %w", err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mail: %w", err)
	}
	defer func() { _ = c.Close() }()
	if s.url.Scheme == "smtp" {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
				return fmt.Errorf("mail: starttls: %w", err)
			}
		}
	}
	if s.url.User != nil {
		pass, _ := s.url.User.Password()
		if err := c.Auth(smtp.PlainAuth("", s.url.User.Username(), pass, host)); err != nil {
			return fmt.Errorf("mail: auth: %w", err)
		}
	}
	if err := c.Mail(s.from.Address); err != nil {
		return fmt.Errorf("mail: %w", err)
	}
	for _, to := range m.To {
		if err := c.Rcpt(to); err != nil {
			return fmt.Errorf("mail: recipient: %w", err)
		}
	}
	wc, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: %w", err)
	}
	if _, err := wc.Write(msg); err != nil {
		return fmt.Errorf("mail: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("mail: %w", err)
	}
	return c.Quit()
}

// Discard drops every message (no SMTP_URL configured).
type Discard struct{}

// Send implements Sender.
func (Discard) Send(context.Context, Message) error { return nil }
