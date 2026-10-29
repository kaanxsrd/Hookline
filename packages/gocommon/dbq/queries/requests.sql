-- name: InsertRequest :exec
INSERT INTO request (
  id, received_at, endpoint_id, org_id, method, path, query, headers, content_type,
  body_inline, body_s3_key, body_size, body_sha256, source_ip, user_agent,
  signature_status, response_status, duration_ms
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
);

-- name: EnsureRequestPartitions :one
-- Creates missing daily partitions in [from_day, to_day]; returns how many were created.
SELECT hookline_ensure_request_partitions(sqlc.arg(from_day)::date, sqlc.arg(to_day)::date)::int AS created;

-- name: DropRequestPartitionsBefore :many
-- Drops partitions holding only requests received before before_day (UTC).
SELECT hookline_drop_request_partitions_before(sqlc.arg(before_day)::date)::text AS name;

-- name: ListRequestSummariesAfter :many
-- Replays the requests a reconnecting live stream missed, oldest first.
-- since bounds received_at (from the last seen UUIDv7, minus a clock-skew
-- margin) so PostgreSQL only scans the most recent partitions.
SELECT id, endpoint_id, method, path, content_type, body_size, source_ip,
       signature_status, response_status, received_at
FROM request
WHERE endpoint_id = $1
  AND received_at >= sqlc.arg(since)::timestamptz
  AND id > sqlc.arg(after_id)::uuid
ORDER BY id
LIMIT sqlc.arg(max_rows)::int;
