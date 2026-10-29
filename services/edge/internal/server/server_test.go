package server_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/services/edge/internal/server"
)

func ok(context.Context) error   { return nil }
func fail(context.Context) error { return errors.New("down") }

func TestRoutes(t *testing.T) {
	h := server.New(logging.Discard(), server.Routes{})

	tests := []struct {
		name     string
		method   string
		path     string
		wantCode int
		wantBody string
	}{
		{"healthz", http.MethodGet, "/healthz", http.StatusOK, `{"status":"ok"}`},
		{"readyz without checks", http.MethodGet, "/readyz", http.StatusOK, `{"status":"ready","checks":{}}`},
		{"unknown route", http.MethodGet, "/nope", http.StatusNotFound, `{"error":{"code":"not_found","message":"No route matches this URL."}}`},
		{"wrong method", http.MethodPost, "/healthz", http.StatusMethodNotAllowed, `{"error":{"code":"method_not_allowed","message":"This route does not accept that method."}}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))

			assert.Equal(t, tt.wantCode, rec.Code)
			assert.JSONEq(t, tt.wantBody, rec.Body.String())
			assert.NotEmpty(t, rec.Header().Get(httpx.RequestIDHeader), "every response carries a request ID")
		})
	}
}

func TestReadyz(t *testing.T) {
	tests := []struct {
		name     string
		checks   []server.Check
		wantCode int
		wantBody string
	}{
		{
			"all ok",
			[]server.Check{{Name: "postgres", Critical: true, Probe: ok}, {Name: "redis", Probe: ok}},
			http.StatusOK, `{"status":"ready","checks":{"postgres":"ok","redis":"ok"}}`,
		},
		{
			"redis down is degraded, still ready",
			[]server.Check{{Name: "postgres", Critical: true, Probe: ok}, {Name: "redis", Probe: fail}},
			http.StatusOK, `{"status":"degraded","checks":{"postgres":"ok","redis":"fail"}}`,
		},
		{
			"postgres down is unavailable",
			[]server.Check{{Name: "postgres", Critical: true, Probe: fail}, {Name: "s3", Probe: ok}},
			http.StatusServiceUnavailable, `{"status":"unavailable","checks":{"postgres":"fail","s3":"ok"}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			server.New(logging.Discard(), server.Routes{Checks: tt.checks}).
				ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
			assert.Equal(t, tt.wantCode, rec.Code)
			assert.JSONEq(t, tt.wantBody, rec.Body.String())
		})
	}
}
