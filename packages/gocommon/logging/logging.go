// Package logging builds the slog loggers shared by every Hookline Go service.
//
// Logs must never contain request bodies, header values or secrets. Callers
// log identifiers (request IDs, endpoint IDs) and sizes instead.
package logging

import (
	"fmt"
	"io"
	"log/slog"
	"strings"
)

// Levels and formats accepted by New, for use with config.Loader.OneOf.
var (
	Levels  = []string{"debug", "info", "warn", "error"}
	Formats = []string{"json", "text"}
)

// Options configures New.
type Options struct {
	Service string // added to every record as "service"
	Level   string // one of Levels
	Format  string // one of Formats
}

// New returns a logger writing to w.
func New(w io.Writer, opts Options) (*slog.Logger, error) {
	level, err := ParseLevel(opts.Level)
	if err != nil {
		return nil, err
	}
	hopts := &slog.HandlerOptions{Level: level}

	var h slog.Handler
	switch strings.ToLower(opts.Format) {
	case "", "json":
		h = slog.NewJSONHandler(w, hopts)
	case "text":
		h = slog.NewTextHandler(w, hopts)
	default:
		return nil, fmt.Errorf("unknown log format %q", opts.Format)
	}

	logger := slog.New(h)
	if opts.Service != "" {
		logger = logger.With("service", opts.Service)
	}
	return logger, nil
}

// ParseLevel converts a level name into a slog.Level. An empty name means info.
func ParseLevel(name string) (slog.Level, error) {
	switch strings.ToLower(name) {
	case "debug":
		return slog.LevelDebug, nil
	case "", "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("unknown log level %q", name)
	}
}

// Discard returns a logger that drops everything, for tests.
func Discard() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}
