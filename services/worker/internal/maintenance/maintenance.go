// Package maintenance holds the worker's periodic jobs: partition upkeep,
// retention, anonymous endpoint expiry, usage rollups, idempotency cleanup
// and the sweep of orphaned stored bodies.
package maintenance

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"path"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/jobs"
)

// Deps are shared by every maintenance worker. Blobs may be nil.
type Deps struct {
	Queries *dbq.Queries
	Blobs   blob.Store
	Logger  *slog.Logger
	Now     func() time.Time
}

func maintenanceOpts() river.InsertOpts {
	return river.InsertOpts{Queue: jobs.QueueMaintenance, MaxAttempts: 3}
}

type (
	// partitionsArgs keeps request partitions a week ahead.
	partitionsArgs struct{}
	// retentionArgs deletes requests older than their endpoint's retention.
	retentionArgs struct{}
	// anonymousExpireArgs removes expired anonymous endpoints.
	anonymousExpireArgs struct{}
	// usageRollupArgs recomputes usage_daily.
	usageRollupArgs struct{}
	// idempotencyCleanupArgs deletes expired idempotency keys.
	idempotencyCleanupArgs struct{}
	// orphansArgs deletes stored bodies whose request no longer exists.
	orphansArgs struct{}
)

func (partitionsArgs) Kind() string         { return "partitions.ensure" }
func (retentionArgs) Kind() string          { return "retention.enforce" }
func (anonymousExpireArgs) Kind() string    { return "anonymous.expire" }
func (usageRollupArgs) Kind() string        { return "usage.rollup" }
func (idempotencyCleanupArgs) Kind() string { return "idempotency.cleanup" }
func (orphansArgs) Kind() string            { return "s3.orphans" }

func (partitionsArgs) InsertOpts() river.InsertOpts         { return maintenanceOpts() }
func (retentionArgs) InsertOpts() river.InsertOpts          { return maintenanceOpts() }
func (anonymousExpireArgs) InsertOpts() river.InsertOpts    { return maintenanceOpts() }
func (usageRollupArgs) InsertOpts() river.InsertOpts        { return maintenanceOpts() }
func (idempotencyCleanupArgs) InsertOpts() river.InsertOpts { return maintenanceOpts() }
func (orphansArgs) InsertOpts() river.InsertOpts            { return maintenanceOpts() }

// Register adds every maintenance worker.
func Register(workers *river.Workers, d *Deps) {
	river.AddWorker(workers, &partitionsWorker{d: d})
	river.AddWorker(workers, &retentionWorker{d: d})
	river.AddWorker(workers, &anonymousWorker{d: d})
	river.AddWorker(workers, &rollupWorker{d: d})
	river.AddWorker(workers, &idempotencyWorker{d: d})
	river.AddWorker(workers, &orphansWorker{d: d})
}

// PeriodicJobs schedules the maintenance jobs. River runs them on the elected
// leader only, so several worker processes never duplicate them.
func PeriodicJobs() []*river.PeriodicJob {
	every := func(d time.Duration, args river.JobArgs) *river.PeriodicJob {
		return river.NewPeriodicJob(river.PeriodicInterval(d),
			func() (river.JobArgs, *river.InsertOpts) { return args, nil },
			&river.PeriodicJobOpts{RunOnStart: true})
	}
	return []*river.PeriodicJob{
		every(time.Hour, partitionsArgs{}),
		every(time.Hour, retentionArgs{}),
		every(15*time.Minute, anonymousExpireArgs{}),
		every(time.Hour, usageRollupArgs{}),
		every(time.Hour, idempotencyCleanupArgs{}),
		every(24*time.Hour, orphansArgs{}),
	}
}

func day(t time.Time) time.Time { return t.UTC().Truncate(24 * time.Hour) }

type partitionsWorker struct {
	river.WorkerDefaults[partitionsArgs]
	d *Deps
}

func (w *partitionsWorker) Work(ctx context.Context, _ *river.Job[partitionsArgs]) error {
	today := day(w.d.Now())
	created, err := w.d.Queries.EnsureRequestPartitions(ctx, dbq.EnsureRequestPartitionsParams{
		FromDay: today.AddDate(0, 0, -1), ToDay: today.AddDate(0, 0, 7),
	})
	if err != nil {
		return err
	}
	if created > 0 {
		w.d.Logger.InfoContext(ctx, "created request partitions", "count", created)
	}
	return nil
}

type retentionWorker struct {
	river.WorkerDefaults[retentionArgs]
	d *Deps
}

// Work deletes, per endpoint, requests older than its retention (stored
// bodies first, then rows in batches) and their deliveries, then drops day
// partitions older than the longest retention any endpoint has.
func (w *retentionWorker) Work(ctx context.Context, _ *river.Job[retentionArgs]) error {
	endpoints, err := w.d.Queries.ListEndpointRetention(ctx)
	if err != nil {
		return err
	}
	now := w.d.Now()
	var removed int64
	for _, ep := range endpoints {
		cutoff := now.Add(-time.Duration(ep.RetentionHours) * time.Hour)
		for {
			keys, err := w.d.Queries.ListExpiredStoredBodies(ctx, dbq.ListExpiredStoredBodiesParams{EndpointID: ep.ID, Cutoff: cutoff})
			if err != nil {
				return err
			}
			if len(keys) > 0 && w.d.Blobs != nil {
				if err := w.d.Blobs.Delete(ctx, keys...); err != nil {
					return fmt.Errorf("delete stored bodies: %w", err)
				}
			}
			n, err := w.d.Queries.DeleteExpiredRequests(ctx, dbq.DeleteExpiredRequestsParams{EndpointID: ep.ID, Cutoff: cutoff})
			if err != nil {
				return err
			}
			removed += n
			if n == 0 && len(keys) == 0 {
				break
			}
		}
		if _, err := w.d.Queries.DeleteExpiredDeliveries(ctx, dbq.DeleteExpiredDeliveriesParams{EndpointID: ep.ID, Cutoff: cutoff}); err != nil {
			return err
		}
	}

	maxHours, err := w.d.Queries.MaxRetentionHours(ctx)
	if err != nil {
		return err
	}
	keepDays := int(math.Ceil(float64(maxHours)/24)) + 1
	dropped, err := w.d.Queries.DropRequestPartitionsBefore(ctx, day(now).AddDate(0, 0, -keepDays))
	if err != nil {
		return err
	}
	if removed > 0 || len(dropped) > 0 {
		w.d.Logger.InfoContext(ctx, "retention enforced", "requests_deleted", removed, "partitions_dropped", len(dropped))
	}
	return nil
}

type anonymousWorker struct {
	river.WorkerDefaults[anonymousExpireArgs]
	d *Deps
}

func (w *anonymousWorker) Work(ctx context.Context, _ *river.Job[anonymousExpireArgs]) error {
	// Requests cascade; their stored bodies are swept by s3.orphans.
	ids, err := w.d.Queries.ExpireAnonymousEndpoints(ctx)
	if err != nil {
		return err
	}
	if len(ids) > 0 {
		w.d.Logger.InfoContext(ctx, "expired anonymous endpoints", "count", len(ids))
	}
	return nil
}

type rollupWorker struct {
	river.WorkerDefaults[usageRollupArgs]
	d *Deps
}

func (w *rollupWorker) Work(ctx context.Context, _ *river.Job[usageRollupArgs]) error {
	// Yesterday too, so the last hour of a day is never missed.
	return w.d.Queries.RollupUsage(ctx, day(w.d.Now()).AddDate(0, 0, -1))
}

type idempotencyWorker struct {
	river.WorkerDefaults[idempotencyCleanupArgs]
	d *Deps
}

func (w *idempotencyWorker) Work(ctx context.Context, _ *river.Job[idempotencyCleanupArgs]) error {
	_, err := w.d.Queries.DeleteExpiredIdempotencyKeys(ctx)
	return err
}

type orphansWorker struct {
	river.WorkerDefaults[orphansArgs]
	d *Deps
}

// orphanGrace leaves young objects alone: intake uploads a body before the
// request row commits.
const orphanGrace = time.Hour

func (w *orphansWorker) Timeout(*river.Job[orphansArgs]) time.Duration { return time.Hour }

// Work walks the bucket and deletes bodies whose request row is gone (deleted
// endpoints, dropped partitions). Keys that do not end in a request ID are
// never touched.
func (w *orphansWorker) Work(ctx context.Context, _ *river.Job[orphansArgs]) error {
	if w.d.Blobs == nil {
		return nil
	}
	cutoff := w.d.Now().Add(-orphanGrace)
	var deleted int
	after := ""
	for {
		objects, err := w.d.Blobs.List(ctx, after, 1000)
		if err != nil {
			return err
		}
		if len(objects) == 0 {
			break
		}
		after = objects[len(objects)-1].Key

		byID := map[uuid.UUID]string{}
		ids := []uuid.UUID{}
		for _, o := range objects {
			id, err := uuid.Parse(path.Base(o.Key))
			if err != nil || o.LastModified.After(cutoff) {
				continue
			}
			byID[id] = o.Key
			ids = append(ids, id)
		}
		if len(ids) == 0 {
			continue
		}
		existing, err := w.d.Queries.ExistingRequestIDs(ctx, ids)
		if err != nil {
			return err
		}
		for _, id := range existing {
			delete(byID, id)
		}
		keys := make([]string, 0, len(byID))
		for _, k := range byID {
			keys = append(keys, k)
		}
		if len(keys) > 0 {
			if err := w.d.Blobs.Delete(ctx, keys...); err != nil {
				return err
			}
			deleted += len(keys)
		}
	}
	if deleted > 0 {
		w.d.Logger.InfoContext(ctx, "deleted orphaned bodies", "count", deleted)
	}
	return nil
}
