package server_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/services/edge/internal/server"
)

func TestRoutes(t *testing.T) {
	h := server.New(logging.Discard())

	tests := []struct {
		name     string
		method   string
		path     string
		wantCode int
		wantBody string
	}{
		{"healthz", http.MethodGet, "/healthz", http.StatusOK, `{"status":"ok"}`},
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
