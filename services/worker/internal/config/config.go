// Package config loads and validates the worker configuration.
package config

import (
	"time"

	"github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
)

// Config is the worker configuration.
type Config struct {
	HealthAddr      string        // WORKER_HEALTH_ADDR: internal listener for /healthz
	LogLevel        string        // LOG_LEVEL
	LogFormat       string        // LOG_FORMAT
	ShutdownTimeout time.Duration // WORKER_SHUTDOWN_TIMEOUT: time allowed for running jobs to finish
}

// Load reads the configuration through l and returns every validation error at once.
func Load(l *config.Loader) (Config, error) {
	c := Config{
		HealthAddr:      l.Addr("WORKER_HEALTH_ADDR", ":8081"),
		LogLevel:        l.OneOf("LOG_LEVEL", "info", logging.Levels...),
		LogFormat:       l.OneOf("LOG_FORMAT", "json", logging.Formats...),
		ShutdownTimeout: l.Duration("WORKER_SHUTDOWN_TIMEOUT", 30*time.Second),
	}
	return c, l.Err()
}
