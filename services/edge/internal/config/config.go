// Package config loads and validates the edge server configuration.
package config

import (
	"time"

	"github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
)

// Config is the edge server configuration.
type Config struct {
	Addr            string        // EDGE_ADDR: public listener (intake, SSE, tunnel, health)
	LogLevel        string        // LOG_LEVEL
	LogFormat       string        // LOG_FORMAT
	ShutdownTimeout time.Duration // EDGE_SHUTDOWN_TIMEOUT: drain window for in-flight requests
}

// Load reads the configuration through l and returns every validation error at once.
func Load(l *config.Loader) (Config, error) {
	c := Config{
		Addr:            l.Addr("EDGE_ADDR", ":8080"),
		LogLevel:        l.OneOf("LOG_LEVEL", "info", logging.Levels...),
		LogFormat:       l.OneOf("LOG_FORMAT", "json", logging.Formats...),
		ShutdownTimeout: l.Duration("EDGE_SHUTDOWN_TIMEOUT", 25*time.Second),
	}
	return c, l.Err()
}
