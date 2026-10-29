package health_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/services/worker/internal/health"
)

func TestHandler(t *testing.T) {
	var readyErr error
	h := health.Handler(logging.Discard(), func(context.Context) error { return readyErr })

	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	rec := get("/healthz")
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"status":"ok"}`, rec.Body.String())

	assert.Equal(t, http.StatusOK, get("/readyz").Code)
	readyErr = errors.New("db down")
	rec = get("/readyz")
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.NotContains(t, rec.Body.String(), "db down")

	assert.Equal(t, http.StatusNotFound, get("/other").Code)
}
