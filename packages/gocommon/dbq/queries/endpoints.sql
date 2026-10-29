-- name: GetEndpointForIntake :one
-- Everything intake needs to accept a request and answer the sender,
-- including the owner's plan (null for anonymous endpoints).
SELECT e.id, e.org_id, e.slug, e.status, e.response_mode, e.response_status,
       e.response_headers, e.response_body, e.response_delay_ms, e.sync_timeout_ms,
       e.signature_provider, e.signature_secret_enc, e.expires_at, e.created_at,
       s.plan, s.plan_override
FROM endpoint e
LEFT JOIN subscription s ON s.org_id = e.org_id
WHERE e.slug = $1;

-- name: CountEndpointRequestsSince :one
-- Used for anonymous endpoints (at most 100 rows); the received_at bound
-- lets PostgreSQL skip partitions older than the endpoint.
SELECT count(*)::bigint
FROM request
WHERE endpoint_id = $1 AND received_at >= sqlc.arg(since)::timestamptz;

-- name: AddEndpointRequests :exec
-- Applied in batches by the edge's counter flusher, never per request.
UPDATE endpoint
SET request_count = request_count + sqlc.arg(n)::bigint,
    last_request_at = GREATEST(last_request_at, sqlc.arg(last_request_at)::timestamptz)
WHERE id = $1;
