// Command edge is Hookline's public-facing Go server: webhook intake, live
// SSE streams and CLI tunnels.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"golang.org/x/sync/errgroup"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/clientip"
	gcfg "github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/packages/gocommon/db"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/packages/gocommon/redisx"
	"github.com/kaanxsrd/hookline/services/edge/internal/config"
	"github.com/kaanxsrd/hookline/services/edge/internal/counters"
	"github.com/kaanxsrd/hookline/services/edge/internal/endpoints"
	"github.com/kaanxsrd/hookline/services/edge/internal/intake"
	"github.com/kaanxsrd/hookline/services/edge/internal/live"
	"github.com/kaanxsrd/hookline/services/edge/internal/metrics"
	"github.com/kaanxsrd/hookline/services/edge/internal/ratelimit"
	"github.com/kaanxsrd/hookline/services/edge/internal/server"
	"github.com/kaanxsrd/hookline/services/edge/internal/stream"
	"github.com/kaanxsrd/hookline/services/edge/internal/streamauth"
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

	pool, err := db.Open(ctx, cfg.DatabaseURL, db.Options{MaxConns: int32(cfg.DBMaxConns), ApplicationName: "hookline-edge"}) //nolint:gosec // bounded to 1..500 by config
	if err != nil {
		return err
	}
	defer pool.Close()
	queries := dbq.New(pool)

	rdb, err := redisx.Open(cfg.RedisURL, "hookline-edge")
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.WarnContext(ctx, "redis unreachable at startup; intake continues without cache, rate limits and live updates", "error", err)
	}

	var blobs blob.Store
	checks := []server.Check{
		{Name: "postgres", Critical: true, Probe: pool.Ping},
		{Name: "redis", Probe: func(ctx context.Context) error { return rdb.Ping(ctx).Err() }},
	}
	if cfg.S3Enabled() {
		s3 := blob.NewS3(cfg.S3)
		blobs = s3
		checks = append(checks, server.Check{Name: "s3", Probe: s3.Ping})
	} else {
		logger.WarnContext(ctx, "S3_BUCKET is not set; bodies over 64 KiB will be rejected")
	}

	// Insert-only River client: the worker runs the jobs.
	jobClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{Logger: logger})
	if err != nil {
		return fmt.Errorf("river client: %w", err)
	}

	m := metrics.New()
	ctrs := counters.New(queries, logger, time.Second)
	intakeRules := entitlements.Intake()
	handler := intake.New(intake.Deps{
		Pool:      pool,
		Queries:   queries,
		Jobs:      jobClient,
		Endpoints: endpoints.NewCache(queries, rdb, cfg.PlanOverride, logger),
		Limiter:   ratelimit.New(rdb, ratelimit.Rule{Rate: intakeRules.PerIPRatePerSecond, Burst: intakeRules.PerIPBurst}),
		Blobs:     blobs,
		Publisher: live.NewPublisher(rdb),
		Counters:  ctrs,
		IPs:       clientip.New(cfg.TrustedProxies),
		Metrics:   m,
		Logger:    logger,
	})

	tokens, err := streamauth.NewVerifier(cfg.StreamTokenSecret)
	if err != nil {
		return err
	}
	hub := stream.NewHub(rdb, logger)
	streams := &stream.Handler{
		Hub: hub, Queries: queries, Tokens: tokens, AllowOrigin: cfg.AppOrigin,
		Metrics: m, Logger: logger,
	}

	public := httpx.NewServer(server.New(logger, server.Routes{Intake: handler, Stream: streams, Checks: checks}), logger)
	// Open streams would otherwise hold a graceful shutdown until its deadline.
	public.RegisterOnShutdown(hub.Shutdown)
	internal := httpx.NewServer(promhttp.HandlerFor(m.Registry, promhttp.HandlerOpts{}), logger)

	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error { return httpx.ListenAndServe(gctx, public, cfg.Addr, logger, cfg.ShutdownTimeout) })
	g.Go(func() error { return httpx.ListenAndServe(gctx, internal, cfg.MetricsAddr, logger, 5*time.Second) })
	g.Go(func() error {
		hub.Run(gctx)
		return nil
	})
	g.Go(func() error {
		// Runs until the servers have drained, then flushes the last counts.
		ctrs.Run(gctx)
		return nil
	})
	return g.Wait()
}
