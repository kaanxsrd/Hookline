// Package notify sends operational emails to an organization's owners and
// admins: a destination failing after every retry (at most once an hour per
// destination) and monthly usage at 80 % and 100 % of the plan (once each).
package notify

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/riverqueue/river"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
	"github.com/kaanxsrd/hookline/packages/gocommon/jobs"
	"github.com/kaanxsrd/hookline/packages/gocommon/mail"
)

// Deps are shared by the notification jobs.
type Deps struct {
	Queries      *dbq.Queries
	Mail         mail.Sender
	AppURL       string
	PlanOverride entitlements.Plan
	Logger       *slog.Logger
	Now          func() time.Time
}

// DeliveryFailingArgs announces that a delivery failed after every attempt.
type DeliveryFailingArgs struct {
	DestinationID uuid.UUID `json:"destination_id"`
	// LastResult is the last attempt's status or error, for the email.
	LastResult string `json:"last_result"`
}

// Kind implements river.JobArgs.
func (DeliveryFailingArgs) Kind() string { return "notify.delivery_failing" }

// InsertOpts implements river.JobArgsWithInsertOpts.
func (DeliveryFailingArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: jobs.QueueMaintenance, MaxAttempts: 5}
}

// Register adds the notification workers.
func Register(workers *river.Workers, d *Deps) {
	river.AddWorker(workers, &deliveryFailingWorker{d: d})
}

func interval(d time.Duration) pgtype.Interval {
	return pgtype.Interval{Microseconds: d.Microseconds(), Valid: true}
}

// claim records the notification unless it was sent within window; it
// returns ok=false when it should not be sent.
func (d *Deps) claim(ctx context.Context, key string, org uuid.UUID, window time.Duration) (uuid.UUID, bool, error) {
	id, err := d.Queries.ClaimNotification(ctx, dbq.ClaimNotificationParams{Key: key, OrgID: &org, Window: interval(window)})
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	return id, true, nil
}

// send delivers to the organization's owners and admins; a failed send
// releases the claim so the job's retry can try again.
func (d *Deps) send(ctx context.Context, claim, org uuid.UUID, subject, template string, data any) error {
	to, err := d.Queries.ListOrgAdminEmails(ctx, org)
	if err != nil {
		return err
	}
	if len(to) == 0 {
		return nil
	}
	if err := d.Mail.Send(ctx, mail.Message{To: to, Subject: subject, Template: template, Data: data}); err != nil {
		if rerr := d.Queries.ReleaseNotification(context.WithoutCancel(ctx), claim); rerr != nil {
			d.Logger.WarnContext(ctx, "release notification claim", "error", rerr)
		}
		return fmt.Errorf("send %s email: %w", template, err)
	}
	d.Logger.InfoContext(ctx, "notification sent", "template", template, "org_id", org, "recipients", len(to))
	return nil
}

type deliveryFailingWorker struct {
	river.WorkerDefaults[DeliveryFailingArgs]
	d *Deps
}

func (w *deliveryFailingWorker) Work(ctx context.Context, job *river.Job[DeliveryFailingArgs]) error {
	n, err := w.d.Queries.GetDestinationNotice(ctx, job.Args.DestinationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // the destination was deleted since
	}
	if err != nil {
		return err
	}
	claim, ok, err := w.d.claim(ctx, "delivery_failing:"+job.Args.DestinationID.String(), n.OrgID, time.Hour)
	if err != nil || !ok {
		return err
	}
	return w.d.send(ctx, claim, n.OrgID, "Deliveries to "+n.DestinationName+" are failing", "delivery_failing", map[string]string{
		"OrgName":         n.OrgName,
		"DestinationName": n.DestinationName,
		"DestinationURL":  n.DestinationUrl,
		"EndpointName":    n.EndpointName,
		"LastResult":      job.Args.LastResult,
		"URL":             strings.TrimRight(w.d.AppURL, "/") + "/" + n.OrgSlug + "/deliveries?status=failed",
	})
}

// thresholds are checked from the highest: reaching 100 % first also marks
// 80 % as sent, so nobody gets "80 %" after "100 %".
var thresholds = []int64{100, 80}

// CheckUsage emails organizations whose requests this month crossed 80 % or
// 100 % of their plan. Called after each usage rollup.
func (d *Deps) CheckUsage(ctx context.Context) error {
	now := d.Now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	rows, err := d.Queries.ListMonthUsage(ctx, monthStart)
	if err != nil {
		return err
	}
	const once = 100 * 365 * 24 * time.Hour // keys carry the month, so once means once
	for _, r := range rows {
		plan := entitlements.Resolve(d.PlanOverride, true, (*string)(r.Plan), (*string)(r.PlanOverride))
		limits := entitlements.For(plan)
		if limits.RequestsPerMonth == entitlements.Unlimited || limits.RequestsPerMonth <= 0 {
			continue
		}
		percent := r.Requests * 100 / limits.RequestsPerMonth
		sent := false
		for _, t := range thresholds {
			if percent < t {
				continue
			}
			key := fmt.Sprintf("usage:%s:%s:%d", r.OrgID, monthStart.Format("2006-01"), t)
			claim, ok, err := d.claim(ctx, key, r.OrgID, once)
			if err != nil {
				return err
			}
			if !ok || sent {
				continue
			}
			sent = true
			subject := fmt.Sprintf("%s has used %d%% of this month's requests", r.OrgName, t)
			if err := d.send(ctx, claim, r.OrgID, subject, "usage_threshold", map[string]string{
				"OrgName": r.OrgName,
				"Percent": strconv.FormatInt(t, 10),
				"Used":    thousands(r.Requests),
				"Limit":   thousands(limits.RequestsPerMonth),
				"Plan":    limits.Name,
				"URL":     strings.TrimRight(d.AppURL, "/") + "/" + r.OrgSlug + "/usage",
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

// thousands formats 1234567 as "1,234,567".
func thousands(n int64) string {
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	return b.String()
}
