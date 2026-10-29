// Package health serves the worker's internal health endpoints.
package health

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
)

// Handler returns the worker's internal HTTP handler. /healthz reports the
// process is up; /readyz additionally probes ready (the database).
func Handler(logger *slog.Logger, ready func(context.Context) error) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpx.Healthz)
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := ready(ctx); err != nil {
			logger.WarnContext(ctx, "readiness probe failed", "error", err)
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/", httpx.NotFound)
	return httpx.RequestID(httpx.Recover(logger)(mux))
}
