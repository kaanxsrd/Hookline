// Package server wires the edge HTTP routes.
package server

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
)

// New returns the edge HTTP handler.
//
// Middleware order matters: RequestID runs first so every log line and
// response carries the ID, and Recover sits inside AccessLog so a recovered
// panic is logged with its 500 status.
func New(logger *slog.Logger) http.Handler {
	r := chi.NewRouter()
	r.Use(httpx.RequestID, httpx.AccessLog(logger), httpx.Recover(logger))
	r.NotFound(httpx.NotFound)
	r.MethodNotAllowed(httpx.MethodNotAllowed)

	r.Get("/healthz", httpx.Healthz)

	return r
}
