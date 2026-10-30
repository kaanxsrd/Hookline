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
	"net/url"
	"strings"
	"sync"
	"time"
)

// Graph sends through Microsoft Graph's sendMail over HTTPS, as the MAIL_FROM
// mailbox of a Microsoft 365 tenant. It is for hosts that block outbound
// SMTP (Railway below the Pro plan). The app registration needs the Mail.Send
// application permission; restrict it to that mailbox with an application
// access policy.
type Graph struct {
	tenant, clientID, secret string
	from                     *mail.Address

	// Overridable in tests.
	TokenURL   string // default https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
	APIBase    string // default https://graph.microsoft.com/v1.0
	HTTPClient *http.Client
	Now        func() time.Time

	mu      sync.Mutex
	token   string
	expires time.Time
}

// NewGraph validates the credentials and the From address ("Name <addr>").
func NewGraph(tenant, clientID, secret, from string) (*Graph, error) {
	if tenant == "" || clientID == "" || secret == "" {
		return nil, errors.New("MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID and MS_GRAPH_CLIENT_SECRET must all be set")
	}
	addr, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("MAIL_FROM: %w", err)
	}
	return &Graph{
		tenant: tenant, clientID: clientID, secret: secret, from: addr,
		TokenURL:   "https://login.microsoftonline.com/" + url.PathEscape(tenant) + "/oauth2/v2.0/token",
		APIBase:    "https://graph.microsoft.com/v1.0",
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
		Now:        time.Now,
	}, nil
}

type graphAddress struct {
	EmailAddress struct {
		Name    string `json:"name,omitempty"`
		Address string `json:"address"`
	} `json:"emailAddress"`
}

func address(name, addr string) graphAddress {
	var a graphAddress
	a.EmailAddress.Name, a.EmailAddress.Address = name, addr
	return a
}

// Send implements Sender.
func (g *Graph) Send(ctx context.Context, m Message) error {
	html, _, err := Render(m.Template, m.Data)
	if err != nil {
		return fmt.Errorf("mail: render %s: %w", m.Template, err)
	}
	type body struct {
		ContentType string `json:"contentType"`
		Content     string `json:"content"`
	}
	type message struct {
		Subject      string         `json:"subject"`
		Body         body           `json:"body"`
		From         graphAddress   `json:"from"`
		ToRecipients []graphAddress `json:"toRecipients"`
	}
	msg := message{
		Subject: m.Subject,
		Body:    body{ContentType: "HTML", Content: html},
		From:    address(g.from.Name, g.from.Address),
	}
	for _, to := range m.To {
		msg.ToRecipients = append(msg.ToRecipients, address("", to))
	}
	payload, err := json.Marshal(map[string]any{"message": msg, "saveToSentItems": false})
	if err != nil {
		return err
	}

	token, err := g.accessToken(ctx)
	if err != nil {
		return err
	}
	endpoint := g.APIBase + "/users/" + url.PathEscape(g.from.Address) + "/sendMail"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("mail: graph sendMail: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusAccepted {
		return nil
	}
	if resp.StatusCode == http.StatusUnauthorized {
		g.forgetToken() // revoked or rotated: the retry fetches a new one
	}
	return fmt.Errorf("mail: graph sendMail: %s: %s", resp.Status, graphError(resp.Body))
}

// accessToken returns a cached app-only token, fetching a new one a minute before expiry.
func (g *Graph) accessToken(ctx context.Context) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.token != "" && g.Now().Before(g.expires) {
		return g.token, nil
	}
	form := url.Values{
		"client_id":     {g.clientID},
		"client_secret": {g.secret},
		"scope":         {"https://graph.microsoft.com/.default"},
		"grant_type":    {"client_credentials"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := g.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("mail: graph token: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("mail: graph token: %s: %s", resp.Status, graphError(resp.Body))
	}
	var t struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&t); err != nil || t.AccessToken == "" {
		return "", errors.New("mail: graph token: no access token in the response")
	}
	g.token = t.AccessToken
	g.expires = g.Now().Add(time.Duration(t.ExpiresIn)*time.Second - time.Minute)
	return g.token, nil
}

func (g *Graph) forgetToken() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.token = ""
}

// graphError extracts Graph's or Entra's error message without echoing secrets.
func graphError(r io.Reader) string {
	var e struct {
		Error any    `json:"error"`
		Desc  string `json:"error_description"`
	}
	b, _ := io.ReadAll(io.LimitReader(r, 8<<10))
	if json.Unmarshal(b, &e) != nil {
		return strings.TrimSpace(string(b))
	}
	if e.Desc != "" {
		first, _, _ := strings.Cut(e.Desc, "\r\n")
		return first
	}
	if obj, ok := e.Error.(map[string]any); ok {
		return fmt.Sprintf("%v: %v", obj["code"], obj["message"])
	}
	return fmt.Sprint(e.Error)
}
