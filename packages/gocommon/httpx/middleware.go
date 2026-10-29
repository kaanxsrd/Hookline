package httpx

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/google/uuid"
)

type requestIDKey struct{}

// RequestIDFrom returns the request ID stored by the RequestID middleware, or "".
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// RequestID assigns every request a fresh time-ordered UUIDv7, stores it in the
// context and sets it on the response. Incoming IDs are deliberately ignored:
// senders are untrusted and IDs double as database keys.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := uuid.NewV7()
		if err != nil {
			// NewV7 only fails when the system random source fails.
			WriteError(w, http.StatusInternalServerError, "internal", "Could not allocate a request ID.")
			return
		}
		s := id.String()
		w.Header().Set(RequestIDHeader, s)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, s)))
	})
}

// AccessLog logs one line per request. It records the path but never the query
// string, headers or body, which may carry tokens or customer data.
func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}
			next.ServeHTTP(rec, r)
			status := rec.status
			if status == 0 {
				status = http.StatusOK
			}
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			}
			logger.LogAttrs(r.Context(), level, "http request",
				slog.String("request_id", RequestIDFrom(r.Context())),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", status),
				slog.Int64("bytes", rec.bytes),
				slog.Float64("duration_ms", float64(time.Since(start).Microseconds())/1000),
			)
		})
	}
}

// Recover turns a handler panic into a 500 response and an error log, so no
// panic escapes a handler. http.ErrAbortHandler is re-raised as net/http expects.
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rec := &statusRecorder{ResponseWriter: w}
			defer handlePanic(r.Context(), rec, logger)
			next.ServeHTTP(rec, r)
		})
	}
}

// handlePanic must be deferred directly so that recover sees the panic.
func handlePanic(ctx context.Context, rec *statusRecorder, logger *slog.Logger) {
	v := recover()
	if v == nil {
		return
	}
	if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
		panic(v)
	}
	logger.ErrorContext(ctx, "handler panic",
		"request_id", RequestIDFrom(ctx),
		"panic", v,
		"stack", string(debug.Stack()),
	)
	if rec.status == 0 {
		WriteError(rec, http.StatusInternalServerError, "internal", "Something went wrong.")
	}
}

// statusRecorder captures the status code and body size while keeping the
// optional interfaces (Flusher, Hijacker) that SSE and WebSockets rely on.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += int64(n)
	return n, err
}

func (s *statusRecorder) Flush() {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	_ = http.NewResponseController(s.ResponseWriter).Flush()
}

func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if s.status == 0 {
		s.status = http.StatusSwitchingProtocols
	}
	return http.NewResponseController(s.ResponseWriter).Hijack()
}

func (s *statusRecorder) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}
