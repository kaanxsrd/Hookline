package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

// Resend sends through Resend's HTTPS API (https://resend.com), for hosts
// that block outbound SMTP (Railway below the Pro plan). The MAIL_FROM domain
// must be verified in Resend.
type Resend struct {
	key  string
	from string

	// Overridable in tests.
	APIURL     string // default https://api.resend.com/emails
	HTTPClient *http.Client
}

// NewResend validates the API key and the From address ("Name <addr>").
func NewResend(apiKey, from string) (*Resend, error) {
	if !strings.HasPrefix(apiKey, "re_") {
		return nil, errors.New("RESEND_API_KEY must be a Resend API key (re_...)")
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return nil, fmt.Errorf("MAIL_FROM: %w", err)
	}
	return &Resend{
		key: apiKey, from: from,
		APIURL:     "https://api.resend.com/emails",
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// Send implements Sender.
func (r *Resend) Send(ctx context.Context, m Message) error {
	html, text, err := Render(m.Template, m.Data)
	if err != nil {
		return fmt.Errorf("mail: render %s: %w", m.Template, err)
	}
	payload, err := json.Marshal(map[string]any{
		"from": r.from, "to": m.To, "subject": m.Subject, "html": html, "text": text,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.APIURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("mail: resend: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	var e struct {
		Name    string `json:"name"`
		Message string `json:"message"`
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if json.Unmarshal(b, &e) == nil && e.Message != "" {
		return fmt.Errorf("mail: resend: %s: %s: %s", resp.Status, e.Name, e.Message)
	}
	return fmt.Errorf("mail: resend: %s: %s", resp.Status, strings.TrimSpace(string(b)))
}
