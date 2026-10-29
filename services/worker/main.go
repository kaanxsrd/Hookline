// Command worker runs Hookline's background jobs: forwarding to destinations,
// retries, retention and usage rollups.
package main

import (
	"context"
	"fmt"
	"math/rand/v2"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"golang.org/x/sync/errgroup"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	gcfg "github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/packages/gocommon/db"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/httpx"
	"github.com/kaanxsrd/hookline/packages/gocommon/jobs"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/packages/gocommon/redisx"
	"github.com/kaanxsrd/hookline/packages/gocommon/safehttp"
	"github.com/kaanxsrd/hookline/services/worker/internal/config"
	"github.com/kaanxsrd/hookline/services/worker/internal/deliver"
	"github.com/kaanxsrd/hookline/services/worker/internal/health"
	"github.com/kaanxsrd/hookline/services/worker/internal/maintenance"
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

	// Room for every delivery in flight plus River's own bookkeeping.
	pool, err := db.Open(ctx, cfg.DatabaseURL, db.Options{MaxConns: int32(cfg.DeliveryConcurrency + 10), ApplicationName: "hookline-worker"}) //nolint:gosec // bounded to 1..1000 by config
	if err != nil {
		return err
	}
	defer pool.Close()
	queries := dbq.New(pool)

	rdb, err := redisx.Open(cfg.RedisURL, "hookline-worker")
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()

	var blobs blob.Store
	if cfg.S3Enabled() {
		blobs = blob.NewS3(cfg.S3)
	}
	if cfg.AllowPrivate {
		logger.WarnContext(ctx, "ALLOW_PRIVATE_DESTINATIONS is on: destinations may target loopback and private networks")
	}

	workers := river.NewWorkers()
	river.AddWorker(workers, &deliver.Worker{
		Queries:   queries,
		Blobs:     blobs,
		HTTP:      safehttp.NewClient(safehttp.Options{AllowPrivate: cfg.AllowPrivate}),
		Secrets:   cfg.Secrets,
		Publisher: deliver.RedisPublisher{RDB: rdb},
		Logger:    logger,
		Now:       time.Now,
		Rand:      rand.Float64,
	})
	maintenance.Register(workers, &maintenance.Deps{Queries: queries, Blobs: blobs, Logger: logger, Now: time.Now})

	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Logger: logger,
		Queues: map[string]river.QueueConfig{
			jobs.QueueDeliveries:  {MaxWorkers: cfg.DeliveryConcurrency},
			jobs.QueueMaintenance: {MaxWorkers: 2},
		},
		Workers:      workers,
		PeriodicJobs: maintenance.PeriodicJobs(),
		// Above the longest delivery timeout; the worker enforces per-destination timeouts itself.
		JobTimeout: 5 * time.Minute,
	})
	if err != nil {
		return fmt.Errorf("river client: %w", err)
	}

	srv := httpx.NewServer(health.Handler(logger, pool.Ping), logger)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error { return httpx.ListenAndServe(gctx, srv, cfg.HealthAddr, logger, 5*time.Second) })
	g.Go(func() error {
		if err := client.Start(gctx); err != nil {
			return fmt.Errorf("start river: %w", err)
		}
		<-gctx.Done()
		// Let running deliveries finish, then cancel whatever is left; River
		// puts cancelled jobs back so another worker retries them.
		stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownTimeout)
		defer cancel()
		if err := client.Stop(stopCtx); err != nil {
			logger.Warn("jobs did not finish in time; cancelling", "error", err)
			hardCtx, cancelHard := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancelHard()
			return client.StopAndCancel(hardCtx)
		}
		logger.Info("worker stopped")
		return nil
	})
	return g.Wait()
}
