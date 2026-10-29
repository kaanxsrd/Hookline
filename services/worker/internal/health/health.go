// Package health serves the worker's internal health endpoint.
package health

import (
	"log/slog"
	"net/http"

	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
)

// Handler returns the worker's internal HTTP handler.
func Handler(logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpx.Healthz)
	mux.HandleFunc("/", httpx.NotFound)
	return httpx.RequestID(httpx.Recover(logger)(mux))
}
