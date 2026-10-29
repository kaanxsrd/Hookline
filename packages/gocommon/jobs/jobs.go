// Package jobs defines the River job kinds shared by the edge (which enqueues
// deliveries inside the intake transaction), the worker (which runs them) and
// the web app (which enqueues retries and replays by inserting rows with the
// same kind, queue and JSON arguments; see apps/web/lib/jobs.ts).
package jobs

import (
	"github.com/google/uuid"
	"github.com/riverqueue/river"
)

// Queues.
const (
	QueueDeliveries  = "deliveries"
	QueueMaintenance = "maintenance"
)

// DeliverArgs forwards one captured request to one destination. The delivery
// row holds everything else (request, destination, trigger, attempt count).
type DeliverArgs struct {
	DeliveryID uuid.UUID `json:"delivery_id"`
}

// Kind implements river.JobArgs.
func (DeliverArgs) Kind() string { return "deliver" }

// InsertOpts implements river.JobArgsWithInsertOpts. Retries with backoff are
// scheduled by the worker itself (snoozing), bounded by the destination's
// max_attempts; River's own attempts only cover unexpected crashes.
func (DeliverArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueDeliveries, MaxAttempts: 5}
}
