// Package deliver forwards captured requests to destinations.
package deliver

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
	"github.com/kaanxsrd/hookline/packages/gocommon/jobs"
	"github.com/kaanxsrd/hookline/packages/gocommon/safehttp"
	"github.com/kaanxsrd/hookline/packages/gocommon/secretbox"
	"github.com/kaanxsrd/hookline/services/worker/internal/notify"
)

// Publisher announces delivery status changes on an endpoint's live stream.
type Publisher interface {
	PublishDelivery(ctx context.Context, endpointID uuid.UUID, event Event) error
}

// Event is the payload of a "delivery" live event.
type Event struct {
	RequestID  uuid.UUID `json:"request_id"`
	DeliveryID uuid.UUID `json:"delivery_id"`
	Status     string    `json:"status"`
	Statuses   []string  `json:"statuses"`
}

// Worker runs "deliver" jobs.
type Worker struct {
	river.WorkerDefaults[jobs.DeliverArgs]

	Queries   *dbq.Queries
	Blobs     blob.Store
	HTTP      *http.Client
	Secrets   *secretbox.Box
	Publisher Publisher
	Logger    *slog.Logger
	Now       func() time.Time
	Rand      func() float64
}

// hopByHop headers describe one connection and must not be forwarded, nor
// should headers our own proxy adds.
var hopByHop = map[string]bool{
	"connection": true, "keep-alive": true, "proxy-authenticate": true, "proxy-authorization": true,
	"te": true, "trailer": true, "transfer-encoding": true, "upgrade": true, "host": true,
	"content-length": true, "accept-encoding": true, "via": true,
	"x-forwarded-for": true, "x-forwarded-proto": true, "x-forwarded-host": true, "x-forwarded-port": true,
}

// SigningContext is the secretbox context of a destination's signing secret.
func SigningContext(destinationID uuid.UUID) string {
	return "destination.signing_secret:" + destinationID.String()
}

// Work attempts one delivery. Retries are scheduled by snoozing the job, so
// the destination's max_attempts (not River's) bounds them.
func (w *Worker) Work(ctx context.Context, job *river.Job[jobs.DeliverArgs]) error {
	d, err := w.Queries.GetDeliveryWork(ctx, job.Args.DeliveryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // deleted together with its endpoint or destination
	}
	if err != nil {
		return fmt.Errorf("load delivery: %w", err)
	}
	if d.Status != dbq.DeliveryStatusPending {
		return nil // already final (duplicate job)
	}
	if !d.Enabled && d.Trigger == dbq.DeliveryTriggerAuto {
		return w.finish(ctx, d, dbq.DeliveryStatusCancelled, d.AttemptCount, nil)
	}

	req, err := w.Queries.GetRequestForDelivery(ctx, dbq.GetRequestForDeliveryParams{ID: d.RequestID, ReceivedAt: d.RequestReceivedAt})
	if errors.Is(err, pgx.ErrNoRows) {
		return w.finish(ctx, d, dbq.DeliveryStatusCancelled, d.AttemptCount, nil) // aged out by retention
	}
	if err != nil {
		return fmt.Errorf("load request: %w", err)
	}
	if req, err = w.applyOverride(ctx, d.ID, req); err != nil {
		return err
	}

	attemptNo := d.AttemptCount + 1
	outcome := w.attempt(ctx, d, req, attemptNo)
	if err := w.Queries.InsertDeliveryAttempt(ctx, outcome.record); err != nil {
		return fmt.Errorf("record attempt: %w", err)
	}

	switch {
	case outcome.success:
		return w.finish(ctx, d, dbq.DeliveryStatusSucceeded, attemptNo, outcome.record.StatusCode)
	case outcome.retryable && attemptNo < d.MaxAttempts:
		delay := Backoff(int(attemptNo), w.Rand)
		if outcome.retryAfter > 0 {
			delay = outcome.retryAfter
		}
		next := w.Now().Add(delay)
		if err := w.Queries.UpdateDeliveryState(ctx, dbq.UpdateDeliveryStateParams{
			ID: d.ID, Status: dbq.DeliveryStatusPending, AttemptCount: attemptNo,
			NextAttemptAt: &next, LastStatusCode: outcome.record.StatusCode,
		}); err != nil {
			return fmt.Errorf("update delivery: %w", err)
		}
		w.publish(ctx, d, dbq.DeliveryStatusPending)
		return river.JobSnooze(delay)
	default:
		if err := w.finish(ctx, d, dbq.DeliveryStatusFailed, attemptNo, outcome.record.StatusCode); err != nil {
			return err
		}
		w.notifyFailing(ctx, d, outcome)
		return nil
	}
}

// notifyFailing queues the "deliveries are failing" email; the notification
// job debounces it per destination.
func (w *Worker) notifyFailing(ctx context.Context, d dbq.GetDeliveryWorkRow, o outcome) {
	client, err := river.ClientFromContextSafely[pgx.Tx](ctx)
	if err != nil {
		return // run outside River (tests)
	}
	last := "no response"
	switch {
	case o.record.Error != nil:
		last = *o.record.Error
	case o.record.StatusCode != nil:
		last = "HTTP " + strconv.Itoa(int(*o.record.StatusCode))
	}
	if _, err := client.Insert(ctx, notify.DeliveryFailingArgs{DestinationID: d.DestinationID, LastResult: last}, nil); err != nil {
		w.Logger.WarnContext(ctx, "queue failing-destination notification", "error", err)
	}
}

func (w *Worker) finish(ctx context.Context, d dbq.GetDeliveryWorkRow, status dbq.DeliveryStatus, attempts int32, code *int32) error {
	if err := w.Queries.UpdateDeliveryState(ctx, dbq.UpdateDeliveryStateParams{
		ID: d.ID, Status: status, AttemptCount: attempts, LastStatusCode: code,
	}); err != nil {
		return fmt.Errorf("update delivery: %w", err)
	}
	w.publish(ctx, d, status)
	return nil
}

func (w *Worker) publish(ctx context.Context, d dbq.GetDeliveryWorkRow, status dbq.DeliveryStatus) {
	if w.Publisher == nil {
		return
	}
	statuses, err := w.Queries.ListRequestDeliveryStatuses(ctx, d.RequestID)
	if err != nil {
		return
	}
	list := make([]string, len(statuses))
	for i, s := range statuses {
		list[i] = string(s)
	}
	ev := Event{RequestID: d.RequestID, DeliveryID: d.ID, Status: string(status), Statuses: list}
	if err := w.Publisher.PublishDelivery(ctx, d.EndpointID, ev); err != nil {
		w.Logger.DebugContext(ctx, "publish delivery event", "error", err)
	}
}

type outcome struct {
	record     dbq.InsertDeliveryAttemptParams
	success    bool
	retryable  bool
	retryAfter time.Duration
}

func (w *Worker) attempt(ctx context.Context, d dbq.GetDeliveryWorkRow, req dbq.GetRequestForDeliveryRow, attemptNo int32) outcome {
	started := w.Now()
	o := outcome{record: dbq.InsertDeliveryAttemptParams{
		DeliveryID: d.ID, AttemptNo: attemptNo, StartedAt: started, ResponseHeaders: json.RawMessage(`[]`),
	}}
	fail := func(retryable bool, msg string) outcome {
		o.retryable = retryable
		o.record.Error = &msg
		elapsed := float32(w.Now().Sub(started).Seconds() * 1000)
		o.record.DurationMs = &elapsed
		return o
	}

	body, err := w.body(ctx, req)
	if err != nil {
		return fail(true, "could not load the captured body from storage")
	}
	httpReq, err := w.build(ctx, d, req, body, attemptNo)
	if err != nil {
		var blocked bool
		if errors.Is(err, safehttp.ErrBlocked) {
			blocked = true
		}
		return fail(!blocked, err.Error())
	}

	timeout := time.Duration(d.TimeoutMs) * time.Millisecond
	sendCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	resp, err := w.HTTP.Do(httpReq.WithContext(sendCtx))
	if err != nil {
		if errors.Is(err, safehttp.ErrBlocked) {
			return fail(false, "destination not allowed: it resolves to a private or reserved address")
		}
		if sendCtx.Err() != nil {
			return fail(true, fmt.Sprintf("timeout: no response within %s", timeout))
		}
		return fail(true, describeNetError(err))
	}
	defer resp.Body.Close()
	respBody, _, _ := safehttp.ReadLimited(resp.Body)

	elapsed := float32(w.Now().Sub(started).Seconds() * 1000)
	code := int32(resp.StatusCode) //nolint:gosec // HTTP status codes fit easily
	o.record.StatusCode = &code
	o.record.DurationMs = &elapsed
	o.record.ResponseBody = respBody
	o.record.ResponseHeaders = headerPairsJSON(resp.Header)
	o.success = resp.StatusCode >= 200 && resp.StatusCode < 300
	o.retryable = Retryable(resp.StatusCode)
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
		if d, ok := RetryAfter(resp.Header.Get("Retry-After"), w.Now()); ok {
			o.retryAfter = d
		}
	}
	return o
}

// applyOverride swaps in the edited request of an "edit & replay" delivery.
// The captured request itself is never changed.
func (w *Worker) applyOverride(ctx context.Context, deliveryID uuid.UUID, req dbq.GetRequestForDeliveryRow) (dbq.GetRequestForDeliveryRow, error) {
	o, err := w.Queries.GetDeliveryOverride(ctx, deliveryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return req, nil
	}
	if err != nil {
		return req, fmt.Errorf("load replay override: %w", err)
	}
	req.Method, req.Path, req.Query, req.Headers = o.Method, o.Path, o.Query, o.Headers
	req.BodyInline, req.BodyS3Key = o.Body, nil
	req.ContentType = nil // the edited headers carry it
	return req, nil
}

func (w *Worker) body(ctx context.Context, req dbq.GetRequestForDeliveryRow) ([]byte, error) {
	if req.BodyS3Key == nil {
		return req.BodyInline, nil
	}
	if w.Blobs == nil {
		return nil, errors.New("object storage is not configured")
	}
	r, err := w.Blobs.Get(ctx, *req.BodyS3Key)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

// build recreates the captured request for the destination: the original
// method, the path below /h/{slug} appended to the destination's path, both
// query strings, the original headers (without hop-by-hop ones), the
// destination's extra headers, X-Hookline-* metadata and, optionally, a
// Standard Webhooks signature.
func (w *Worker) build(ctx context.Context, d dbq.GetDeliveryWorkRow, req dbq.GetRequestForDeliveryRow, body []byte, attemptNo int32) (*http.Request, error) {
	target, err := safehttp.ValidateURL(d.Url)
	if err != nil {
		return nil, err
	}
	if req.Path != "" && req.Path != "/" {
		target.Path = strings.TrimSuffix(target.Path, "/") + req.Path
		target.RawPath = ""
	}
	var queryPairs [][2]string
	_ = json.Unmarshal(req.Query, &queryPairs)
	if len(queryPairs) > 0 {
		q := target.Query()
		for _, p := range queryPairs {
			q.Add(p[0], p[1])
		}
		target.RawQuery = q.Encode()
	}

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	var headers [][2]string
	_ = json.Unmarshal(req.Headers, &headers)
	connectionScoped := map[string]bool{}
	for _, h := range headers {
		if strings.EqualFold(h[0], "Connection") {
			for name := range strings.SplitSeq(h[1], ",") {
				connectionScoped[strings.ToLower(strings.TrimSpace(name))] = true
			}
		}
	}
	for _, h := range headers {
		name := strings.ToLower(h[0])
		if hopByHop[name] || connectionScoped[name] || strings.HasPrefix(name, "x-hookline-") {
			continue
		}
		httpReq.Header.Add(h[0], h[1])
	}
	var extra [][2]string
	_ = json.Unmarshal(d.ExtraHeaders, &extra)
	for _, h := range extra {
		httpReq.Header.Set(h[0], h[1])
	}

	httpReq.Header.Set("X-Hookline-Request-Id", d.RequestID.String())
	httpReq.Header.Set("X-Hookline-Delivery-Id", d.ID.String())
	httpReq.Header.Set("X-Hookline-Attempt", strconv.Itoa(int(attemptNo)))
	httpReq.Header.Set("X-Hookline-Endpoint", d.EndpointSlug)
	if !slices.Contains([]string{"GET", "HEAD"}, req.Method) && req.ContentType != nil && httpReq.Header.Get("Content-Type") == "" {
		httpReq.Header.Set("Content-Type", *req.ContentType)
	}

	if d.SignWithStandardWebhooks && d.SigningSecretEnc != nil {
		if w.Secrets == nil {
			return nil, errors.New("signing is configured but DATA_ENCRYPTION_KEY is not set")
		}
		secret, err := w.Secrets.Open(*d.SigningSecretEnc, SigningContext(d.DestinationID))
		if err != nil {
			return nil, errors.New("could not decrypt the signing secret")
		}
		sig, err := StandardWebhooksSignature(secret, d.RequestID.String(), w.Now(), body)
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("webhook-id", d.RequestID.String())
		httpReq.Header.Set("webhook-timestamp", strconv.FormatInt(w.Now().Unix(), 10))
		httpReq.Header.Set("webhook-signature", sig)
	}
	return httpReq, nil
}

// StandardWebhooksSignature signs per https://www.standardwebhooks.com:
// v1,base64(HMAC-SHA256(key, "{id}.{timestamp}.{body}")), where the key is
// the base64 part of a "whsec_" secret.
func StandardWebhooksSignature(secret, id string, at time.Time, body []byte) (string, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		return "", errors.New("signing secret is not valid base64")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + strconv.FormatInt(at.Unix(), 10) + "."))
	mac.Write(body)
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}

func headerPairsJSON(h http.Header) json.RawMessage {
	names := make([]string, 0, len(h))
	for name := range h {
		names = append(names, name)
	}
	slices.Sort(names)
	pairs := [][2]string{}
	for _, name := range names {
		for _, v := range h[name] {
			pairs = append(pairs, [2]string{name, v})
		}
	}
	b, _ := json.Marshal(pairs)
	return b
}

// wsaeconnrefused is Winsock's "connection refused" (Windows does not map it
// to syscall.ECONNREFUSED).
const wsaeconnrefused = syscall.Errno(10061)

// describeNetError keeps error messages useful without echoing URLs (which
// may carry tokens in their query strings) or the OS's localized wording.
func describeNetError(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		err = urlErr.Err
	}
	var dnsErr *net.DNSError
	var certErr *tls.CertificateVerificationError
	switch {
	case errors.Is(err, syscall.ECONNREFUSED), errors.Is(err, wsaeconnrefused):
		return "connection refused"
	case errors.As(err, &dnsErr):
		return "the destination's host name does not resolve"
	case errors.As(err, &certErr):
		return "TLS certificate error: " + certErr.Err.Error()
	case errors.Is(err, syscall.ECONNRESET):
		return "connection reset by the destination"
	default:
		return err.Error()
	}
}
