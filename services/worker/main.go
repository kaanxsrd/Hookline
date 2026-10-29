// Command worker runs Hookline's background jobs: forwarding to destinations,
// retries, retention and usage rollups.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	gcfg "github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/services/worker/internal/config"
	"github.com/kaanxsrd/hookline/services/worker/internal/health"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "worker:", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load(gcfg.FromEnv())
	if err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	logger, err := logging.New(os.Stdout, logging.Options{Service: "worker", Level: cfg.LogLevel, Format: cfg.LogFormat})
	if err != nil {
		return err
	}

	srv := httpx.NewServer(health.Handler(logger), logger)
	return httpx.ListenAndServe(ctx, srv, cfg.HealthAddr, logger, cfg.ShutdownTimeout)
}
