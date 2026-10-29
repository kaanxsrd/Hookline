-- name: ExpireAnonymousEndpoints :many
-- Anonymous endpoints are kept an hour past expiry so a late viewer sees "expired".
DELETE FROM endpoint
WHERE org_id IS NULL AND expires_at < now() - interval '1 hour'
RETURNING id;

-- name: ListEndpointRetention :many
-- With the owner's plan, so retention is capped by the plan in force even
-- when an endpoint was configured under a bigger plan.
SELECT e.id, e.retention_hours, e.org_id, s.plan, s.plan_override
FROM endpoint e
LEFT JOIN subscription s ON s.org_id = e.org_id;

-- name: ListExpiredStoredBodies :many
SELECT body_s3_key::text AS key
FROM request
WHERE endpoint_id = $1 AND received_at < sqlc.arg(cutoff)::timestamptz AND body_s3_key IS NOT NULL
LIMIT 1000;

-- name: DeleteExpiredRequests :execrows
-- Batched so a large backlog never holds long locks.
DELETE FROM request
WHERE (id, received_at) IN (
  SELECT r.id, r.received_at FROM request r
  WHERE r.endpoint_id = $1 AND r.received_at < sqlc.arg(cutoff)::timestamptz
  LIMIT 5000
);

-- name: DeleteExpiredDeliveries :execrows
DELETE FROM delivery
WHERE endpoint_id = $1 AND request_received_at < sqlc.arg(cutoff)::timestamptz;

-- name: MaxRetentionHours :one
SELECT COALESCE(max(retention_hours), 24)::int AS hours FROM endpoint;

-- name: DeleteExpiredIdempotencyKeys :execrows
DELETE FROM idempotency_key WHERE expires_at < now();

-- name: RollupUsage :exec
-- Recomputes usage_daily for every UTC day from from_day onwards.
INSERT INTO usage_daily (org_id, day, requests, bytes, deliveries)
SELECT d.org_id, d.day, coalesce(r.requests, 0), coalesce(r.bytes, 0), coalesce(dl.deliveries, 0)
FROM (
  SELECT org_id, (received_at AT TIME ZONE 'UTC')::date AS day FROM request
  WHERE org_id IS NOT NULL AND received_at >= sqlc.arg(from_day)::date
  UNION
  SELECT org_id, (created_at AT TIME ZONE 'UTC')::date FROM delivery
  WHERE org_id IS NOT NULL AND created_at >= sqlc.arg(from_day)::date
) d
LEFT JOIN (
  SELECT org_id, (received_at AT TIME ZONE 'UTC')::date AS day, count(*) AS requests, sum(body_size) AS bytes
  FROM request WHERE org_id IS NOT NULL AND received_at >= sqlc.arg(from_day)::date
  GROUP BY 1, 2
) r ON r.org_id = d.org_id AND r.day = d.day
LEFT JOIN (
  SELECT org_id, (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS deliveries
  FROM delivery WHERE org_id IS NOT NULL AND created_at >= sqlc.arg(from_day)::date
  GROUP BY 1, 2
) dl ON dl.org_id = d.org_id AND dl.day = d.day
WHERE EXISTS (SELECT 1 FROM organization o WHERE o.id = d.org_id)
ON CONFLICT (org_id, day) DO UPDATE
SET requests = EXCLUDED.requests, bytes = EXCLUDED.bytes, deliveries = EXCLUDED.deliveries;

-- name: ExistingRequestIDs :many
SELECT id FROM request WHERE id = ANY(sqlc.arg(ids)::uuid[]);
