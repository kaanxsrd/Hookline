// Package api is a client for Hookline's REST API (/api/v1). The models in
// types.gen.go are generated from api/openapi.yaml by `bun run gen`.
package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"
)

// ResponseError is an error answer from the API ({"error": {"code", "message"}}).
type ResponseError struct {
	Status  int
	Code    string
	Message string
}

func (e *ResponseError) Error() string {
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
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		var e Error
		_ = json.Unmarshal(raw, &e)
		apiErr := &ResponseError{Status: resp.StatusCode, Code: e.Error.Code, Message: e.Error.Message}
		if apiErr.Code == "" {
			apiErr.Code = http.StatusText(resp.StatusCode)
		}
		return apiErr
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
	var e *ResponseError
	return errors.As(err, &e) && e.Code == code
}

// StartLogin requests a device code.
func (c *Client) StartLogin(ctx context.Context, clientName string) (DeviceCode, error) {
	var out DeviceCode
	err := c.do(ctx, http.MethodPost, "/api/v1/cli/device-codes", CreateDeviceCodeJSONRequestBody{ClientName: &clientName}, &out)
	return out, err
}

// PollLogin polls once. Pending states come back as *ResponseError with codes
// authorization_pending or slow_down.
func (c *Client) PollLogin(ctx context.Context, deviceCode string) (DeviceLogin, error) {
	var out DeviceLogin
	err := c.do(ctx, http.MethodPost, "/api/v1/cli/device-codes/poll", PollDeviceCodeJSONRequestBody{DeviceCode: deviceCode}, &out)
	return out, err
}

// Config fetches the instance's public configuration.
func (c *Client) Config(ctx context.Context) (CliConfig, error) {
	var out CliConfig
	err := c.do(ctx, http.MethodGet, "/api/v1/cli/config", nil, &out)
	return out, err
}

// Logout revokes the client's API key.
func (c *Client) Logout(ctx context.Context) error {
	return c.do(ctx, http.MethodPost, "/api/v1/cli/logout", nil, nil)
}

// Me fetches the key's organization and creator.
func (c *Client) Me(ctx context.Context) (Me, error) {
	var out Me
	err := c.do(ctx, http.MethodGet, "/api/v1/me", nil, &out)
	return out, err
}

// ListEndpoints returns every endpoint of the organization, newest first.
func (c *Client) ListEndpoints(ctx context.Context) ([]Endpoint, error) {
	var all []Endpoint
	cursor := ""
	for {
		path := "/api/v1/endpoints?limit=100"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		var page EndpointPage
		if err := c.do(ctx, http.MethodGet, path, nil, &page); err != nil {
			return nil, err
		}
		all = append(all, page.Data...)
		if page.NextCursor == nil || *page.NextCursor == "" {
			return all, nil
		}
		cursor = *page.NextCursor
	}
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
	err := c.do(ctx, http.MethodPost, "/api/v1/endpoints", EndpointCreate{Name: name}, &out)
	return out, err
}

// DeleteEndpoint deletes an endpoint by ID or slug.
func (c *Client) DeleteEndpoint(ctx context.Context, ref string) error {
	return c.do(ctx, http.MethodDelete, "/api/v1/endpoints/"+url.PathEscape(ref), nil, nil)
}

// GetRequest fetches a captured request.
func (c *Client) GetRequest(ctx context.Context, id string) (Request, error) {
	var out Request
	err := c.do(ctx, http.MethodGet, "/api/v1/requests/"+url.PathEscape(id), nil, &out)
	return out, err
}

// Override is an edited request for a replay.
type Override struct {
	Method  string
	Path    string
	Query   string
	Headers [][2]string
	Body    []byte
}

// Replay sends a captured request to a destination (destinationID) or, with
// an empty destinationID, to the connected CLIs.
func (c *Client) Replay(ctx context.Context, id, destinationID string, override *Override) (ReplayResult, error) {
	var in ReplayInput
	if destinationID == "" {
		if err := in.Target.FromReplayInputTarget0(ReplayInputTarget0Cli); err != nil {
			return ReplayResult{}, err
		}
	} else {
		dest, err := uuidFrom(destinationID)
		if err != nil {
			return ReplayResult{}, fmt.Errorf("--destination must be a destination ID: %w", err)
		}
		if err := in.Target.FromReplayInputTarget1(ReplayInputTarget1{DestinationId: dest}); err != nil {
			return ReplayResult{}, err
		}
	}
	if override != nil {
		in.Override = &struct {
			BodyB64 *string `json:"body_b64,omitempty"`
			Headers []Pair  `json:"headers"`
			Method  string  `json:"method"`
			Path    string  `json:"path"`
			Query   *string `json:"query,omitempty"`
		}{Method: override.Method, Path: override.Path, Query: &override.Query, Headers: ToPairs(override.Headers), BodyB64: b64(override.Body)}
	}
	var out ReplayResult
	err := c.do(ctx, http.MethodPost, "/api/v1/requests/"+url.PathEscape(id)+"/replay", in, &out)
	return out, err
}

// SignatureSecret is an endpoint's verification setup.
type SignatureSecret struct {
	Provider SignatureProvider `json:"provider"`
	Secret   string            `json:"secret"`
}

// GetSignatureSecret fetches the endpoint's signature provider and secret.
func (c *Client) GetSignatureSecret(ctx context.Context, ref string) (SignatureSecret, error) {
	var out SignatureSecret
	err := c.do(ctx, http.MethodGet, "/api/v1/endpoints/"+url.PathEscape(ref)+"/signature-secret", nil, &out)
	return out, err
}

// FromPairs turns API pairs into fixed-size pairs, dropping malformed ones.
func FromPairs(pairs []Pair) [][2]string {
	out := make([][2]string, 0, len(pairs))
	for _, p := range pairs {
		if len(p) == 2 {
			out = append(out, [2]string{p[0], p[1]})
		}
	}
	return out
}

// ToPairs turns fixed-size pairs into API pairs.
func ToPairs(pairs [][2]string) []Pair {
	out := make([]Pair, 0, len(pairs))
	for _, p := range pairs {
		out = append(out, Pair{p[0], p[1]})
	}
	return out
}

func uuidFrom(s string) (openapi_types.UUID, error) {
	var u openapi_types.UUID
	err := u.UnmarshalText([]byte(s))
	return u, err
}

func b64(body []byte) *string {
	s := base64.StdEncoding.EncodeToString(body)
	return &s
}
