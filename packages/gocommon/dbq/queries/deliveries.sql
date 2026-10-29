-- name: InsertDelivery :one
INSERT INTO delivery (request_id, request_received_at, destination_id, endpoint_id, org_id, trigger)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id;

-- name: GetDeliveryWork :one
-- Everything the worker needs to attempt a delivery.
SELECT d.id, d.status, d.attempt_count, d.trigger, d.request_id, d.request_received_at,
       d.endpoint_id, d.org_id,
       dst.id AS destination_id, dst.url, dst.enabled, dst.extra_headers, dst.timeout_ms,
       dst.max_attempts, dst.sign_with_standard_webhooks, dst.signing_secret_enc,
       e.slug AS endpoint_slug
FROM delivery d
JOIN destination dst ON dst.id = d.destination_id
JOIN endpoint e ON e.id = d.endpoint_id
WHERE d.id = $1;

-- name: GetRequestForDelivery :one
SELECT id, method, path, query, headers, content_type, body_inline, body_s3_key, received_at
FROM request
WHERE id = $1 AND received_at = $2;

-- name: InsertDeliveryAttempt :exec
INSERT INTO delivery_attempt (
  delivery_id, attempt_no, status_code, error, response_headers, response_body, duration_ms, started_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: UpdateDeliveryState :exec
UPDATE delivery
SET status = $2, attempt_count = $3, next_attempt_at = $4, last_status_code = $5
WHERE id = $1;

-- name: ListRequestDeliveryStatuses :many
SELECT status FROM delivery WHERE request_id = $1 ORDER BY created_at;

-- name: GetDeliveryOverride :one
-- The edited request of an "edit & replay" delivery, if any.
SELECT method, path, query, headers, body
FROM delivery_override
WHERE delivery_id = $1;
