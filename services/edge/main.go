// Command edge is Hookline's public-facing Go server: webhook intake, live
// SSE streams and CLI tunnels.
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
	"github.com/kaanxsrd/hookline/services/edge/internal/config"
	"github.com/kaanxsrd/hookline/services/edge/internal/server"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "edge:", err)
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
	logger, err := logging.New(os.Stdout, logging.Options{Service: "edge", Level: cfg.LogLevel, Format: cfg.LogFormat})
	if err != nil {
		return err
	}

	srv := httpx.NewServer(server.New(logger), logger)
	return httpx.ListenAndServe(ctx, srv, cfg.Addr, logger, cfg.ShutdownTimeout)
}
