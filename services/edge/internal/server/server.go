// Package server wires the edge HTTP routes.
package server

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
)

// Check probes one dependency for /readyz.
type Check struct {
	Name     string
	Critical bool // a failing critical check makes the edge unready
	Probe    func(context.Context) error
}

// Routes are the handlers mounted on the public listener.
type Routes struct {
	Intake http.Handler
	Stream http.Handler
	Checks []Check
}

// New returns the edge HTTP handler.
//
// Middleware order matters: RequestID runs first so every log line and
// response carries the ID, and Recover sits inside AccessLog so a recovered
// panic is logged with its 500 status.
func New(logger *slog.Logger, routes Routes) http.Handler {
	r := chi.NewRouter()
	r.Use(httpx.RequestID, httpx.AccessLog(logger), httpx.Recover(logger))
	r.NotFound(httpx.NotFound)
	r.MethodNotAllowed(httpx.MethodNotAllowed)

	r.Get("/healthz", httpx.Healthz)
	r.Get("/readyz", readyz(logger, routes.Checks))
	if routes.Intake != nil {
		r.Handle("/h/{slug}", routes.Intake)
		r.Handle("/h/{slug}/*", routes.Intake)
	}
	if routes.Stream != nil {
		r.Get("/v1/stream/{endpointId}", routes.Stream.ServeHTTP)
	}
	return r
}

// readyz reports each dependency as "ok" or "fail" (details go to the log,
// not the response). Only critical checks make it answer 503: without Redis
// or object storage the edge still captures webhooks, degraded.
func readyz(logger *slog.Logger, checks []Check) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		results := make(map[string]string, len(checks))
		var mu sync.Mutex
		var wg sync.WaitGroup
		ready, degraded := true, false
		for _, c := range checks {
			wg.Go(func() {
				err := c.Probe(ctx)
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					results[c.Name] = "ok"
					return
				}
				results[c.Name] = "fail"
				logger.WarnContext(ctx, "readiness check failed", "check", c.Name, "error", err)
				if c.Critical {
					ready = false
				} else {
					degraded = true
				}
			})
		}
		wg.Wait()

		status, code := "ready", http.StatusOK
		switch {
		case !ready:
			status, code = "unavailable", http.StatusServiceUnavailable
		case degraded:
			status = "degraded"
		}
		httpx.WriteJSON(w, code, map[string]any{"status": status, "checks": results})
	}
}
