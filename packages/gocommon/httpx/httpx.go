// Package httpx holds the HTTP plumbing shared by Hookline's Go services:
// JSON responses in the public error shape, request IDs, access logging,
// panic recovery and graceful shutdown.
package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// RequestIDHeader is set on every response served by a Hookline Go service.
const RequestIDHeader = "X-Hookline-Request-Id"

// ErrorBody is the single error shape used by every Hookline HTTP API:
// {"error": {"code": "...", "message": "...", "details": ...}}.
type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

// ErrorDetail is the inner object of ErrorBody.
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// WriteJSON writes v as JSON with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	// The status line is already sent; an encoding error can only be a broken
	// connection, which the access log records through the byte count.
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes an ErrorBody with the given status code.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	WriteJSON(w, status, ErrorBody{Error: ErrorDetail{Code: code, Message: message}})
}

// Healthz is a liveness handler: it answers 200 as long as the process serves HTTP.
func Healthz(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// NotFound answers unknown routes in the public error shape.
func NotFound(w http.ResponseWriter, _ *http.Request) {
	WriteError(w, http.StatusNotFound, "not_found", "No route matches this URL.")
}

// MethodNotAllowed answers known routes called with the wrong method.
func MethodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "This route does not accept that method.")
}

// NewServer returns an http.Server with conservative timeouts. WriteTimeout is
// left at zero because SSE and WebSocket handlers hold responses open; handlers
// that need a deadline set one through http.ResponseController.
func NewServer(handler http.Handler, logger *slog.Logger) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
}

// Serve runs srv on ln until ctx is cancelled, then shuts it down gracefully:
// it stops accepting connections and waits up to shutdownTimeout for in-flight
// requests. Long-lived handlers should watch srv.RegisterOnShutdown.
func Serve(ctx context.Context, srv *http.Server, ln net.Listener, logger *slog.Logger, shutdownTimeout time.Duration) error {
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(ln) }()
	logger.InfoContext(ctx, "http server listening", "addr", ln.Addr().String())

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("http server: %w", err)
	case <-ctx.Done():
	}

	logger.InfoContext(ctx, "http server shutting down", "timeout", shutdownTimeout.String())
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		_ = srv.Close()
		return fmt.Errorf("http server shutdown: %w", err)
	}
	if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("http server: %w", err)
	}
	logger.InfoContext(ctx, "http server stopped")
	return nil
}

// ListenAndServe listens on addr and calls Serve.
func ListenAndServe(ctx context.Context, srv *http.Server, addr string, logger *slog.Logger, shutdownTimeout time.Duration) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", addr, err)
	}
	return Serve(ctx, srv, ln, logger, shutdownTimeout)
}
