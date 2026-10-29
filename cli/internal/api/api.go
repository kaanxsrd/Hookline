// Package api is a small client for Hookline's REST API (/api/v1).
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Error is an error answer from the API.
type Error struct {
	Status  int
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("the API answered %d %s", e.Status, e.Code)
}

// Client calls the API of one Hookline instance.
type Client struct {
	BaseURL   string
	APIKey    string
	UserAgent string
	HTTP      *http.Client
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+path, body)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if c.UserAgent != "" {
		req.Header.Set("User-Agent", c.UserAgent)
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach %s: %w", c.BaseURL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		var e struct {
			Error Error `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		e.Error.Status = resp.StatusCode
		if e.Error.Code == "" {
			e.Error.Code = http.StatusText(resp.StatusCode)
		}
		return &e.Error
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("unexpected answer from %s (is --url a Hookline instance?): %w", c.BaseURL, err)
	}
	return nil
}

// IsCode reports whether err is an API error with code.
func IsCode(err error, code string) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}

// DeviceCode starts a device login.
type DeviceCode struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

// StartLogin requests a device code.
func (c *Client) StartLogin(ctx context.Context, clientName string) (DeviceCode, error) {
	var out DeviceCode
	err := c.do(ctx, http.MethodPost, "/api/v1/cli/device-codes", map[string]string{"client_name": clientName}, &out)
	return out, err
}

// Login is the result of an approved device login.
type Login struct {
	APIKey    string `json:"api_key"`
	KeyPrefix string `json:"key_prefix"`
	Org       Org    `json:"org"`
	User      User   `json:"user"`
}

// Org identifies an organization.
type Org struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Plan string `json:"plan,omitempty"`
}

// User identifies a person.
type User struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

// PollLogin polls once. Pending states come back as *Error with codes
// authorization_pending or slow_down.
func (c *Client) PollLogin(ctx context.Context, deviceCode string) (Login, error) {
	var out Login
	err := c.do(ctx, http.MethodPost, "/api/v1/cli/device-codes/poll", map[string]string{"device_code": deviceCode}, &out)
	return out, err
}

// InstanceConfig describes where tunnels connect.
type InstanceConfig struct {
	AppURL    string `json:"app_url"`
	EdgeURL   string `json:"edge_url"`
	TunnelURL string `json:"tunnel_url"`
}

// Config fetches the instance's public configuration.
func (c *Client) Config(ctx context.Context) (InstanceConfig, error) {
	var out InstanceConfig
	err := c.do(ctx, http.MethodGet, "/api/v1/cli/config", nil, &out)
	return out, err
}

// Logout revokes the client's API key.
func (c *Client) Logout(ctx context.Context) error {
	return c.do(ctx, http.MethodPost, "/api/v1/cli/logout", nil, nil)
}

// Me describes the API key's owner.
type Me struct {
	Org Org `json:"org"`
	Key struct {
		ID     string   `json:"id"`
		Name   string   `json:"name"`
		Prefix string   `json:"prefix"`
		Scopes []string `json:"scopes"`
	} `json:"key"`
	User *User `json:"user"`
}

// Me fetches the key's organization and creator.
func (c *Client) Me(ctx context.Context) (Me, error) {
	var out Me
	err := c.do(ctx, http.MethodGet, "/api/v1/me", nil, &out)
	return out, err
}

// Endpoint is an endpoint as the API returns it.
type Endpoint struct {
	ID            string     `json:"id"`
	Slug          string     `json:"slug"`
	URL           string     `json:"url"`
	Name          string     `json:"name"`
	Description   string     `json:"description"`
	Status        string     `json:"status"`
	ResponseMode  string     `json:"response_mode"`
	RequestCount  int64      `json:"request_count"`
	LastRequestAt *time.Time `json:"last_request_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

// ListEndpoints returns the organization's endpoints, newest first.
func (c *Client) ListEndpoints(ctx context.Context) ([]Endpoint, error) {
	var out struct {
		Data []Endpoint `json:"data"`
	}
	err := c.do(ctx, http.MethodGet, "/api/v1/endpoints", nil, &out)
	return out.Data, err
}

// GetEndpoint looks an endpoint up by ID or slug.
func (c *Client) GetEndpoint(ctx context.Context, ref string) (Endpoint, error) {
	var out Endpoint
	err := c.do(ctx, http.MethodGet, "/api/v1/endpoints/"+url.PathEscape(ref), nil, &out)
	return out, err
}

// CreateEndpoint creates an endpoint.
func (c *Client) CreateEndpoint(ctx context.Context, name string) (Endpoint, error) {
	var out Endpoint
	err := c.do(ctx, http.MethodPost, "/api/v1/endpoints", map[string]string{"name": name}, &out)
	return out, err
}

// DeleteEndpoint deletes an endpoint by ID or slug.
func (c *Client) DeleteEndpoint(ctx context.Context, ref string) error {
	return c.do(ctx, http.MethodDelete, "/api/v1/endpoints/"+url.PathEscape(ref), nil, nil)
}

// Request is a captured request with its body.
type Request struct {
	ID       string `json:"id"`
	Endpoint struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
	} `json:"endpoint"`
	Method      string      `json:"method"`
	Path        string      `json:"path"`
	Query       [][2]string `json:"query"`
	Headers     [][2]string `json:"headers"`
	ContentType *string     `json:"content_type"`
	BodySize    int         `json:"body_size"`
	BodyB64     *string     `json:"body_b64"`
	BodyOmitted bool        `json:"body_omitted"`
	ReceivedAt  time.Time   `json:"received_at"`
}

// GetRequest fetches a captured request.
func (c *Client) GetRequest(ctx context.Context, id string) (Request, error) {
	var out Request
	err := c.do(ctx, http.MethodGet, "/api/v1/requests/"+url.PathEscape(id), nil, &out)
	return out, err
}

// Override is an edited request for a replay.
type Override struct {
	Method  string      `json:"method"`
	Path    string      `json:"path"`
	Query   string      `json:"query"`
	Headers [][2]string `json:"headers"`
	BodyB64 *string     `json:"body_b64,omitempty"`
}

// ReplayResult says where a replay went.
type ReplayResult struct {
	Target     string `json:"target"`
	Receivers  int    `json:"receivers"`
	DeliveryID string `json:"delivery_id"`
}

// Replay sends a captured request to a destination (destinationID) or, with
// an empty destinationID, to the connected CLIs.
func (c *Client) Replay(ctx context.Context, id, destinationID string, override *Override) (ReplayResult, error) {
	body := map[string]any{"target": "cli"}
	if destinationID != "" {
		body["target"] = map[string]string{"destination_id": destinationID}
	}
	if override != nil {
		body["override"] = override
	}
	var out ReplayResult
	err := c.do(ctx, http.MethodPost, "/api/v1/requests/"+url.PathEscape(id)+"/replay", body, &out)
	return out, err
}

// SignatureSecret is an endpoint's verification setup.
type SignatureSecret struct {
	Provider string `json:"provider"`
	Secret   string `json:"secret"`
}

// GetSignatureSecret fetches the endpoint's signature provider and secret.
func (c *Client) GetSignatureSecret(ctx context.Context, ref string) (SignatureSecret, error) {
	var out SignatureSecret
	err := c.do(ctx, http.MethodGet, "/api/v1/endpoints/"+url.PathEscape(ref)+"/signature-secret", nil, &out)
	return out, err
}
