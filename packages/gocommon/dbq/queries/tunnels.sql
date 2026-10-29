-- name: ListOrgEndpointsBySlugs :many
-- The endpoints a tunnel session asks for, limited to the API key's organization.
SELECT e.id, e.slug, e.name, e.status, e.response_mode
FROM endpoint e
WHERE e.org_id = $1 AND e.slug = ANY(sqlc.arg(slugs)::text[]);

-- name: GetOrgPlan :one
SELECT s.plan, s.plan_override
FROM organization o
LEFT JOIN subscription s ON s.org_id = o.id
WHERE o.id = $1;

-- name: ListTunnelReplay :many
-- Requests a reconnecting tunnel missed, oldest first. since bounds
-- received_at so only recent partitions are scanned.
SELECT id, endpoint_id, method, path, query, headers, body_inline, body_s3_key, body_size, received_at
FROM request
WHERE endpoint_id = ANY(sqlc.arg(endpoint_ids)::uuid[])
  AND received_at >= sqlc.arg(since)::timestamptz
  AND id > sqlc.arg(after_id)::uuid
ORDER BY id
LIMIT sqlc.arg(max_rows)::int;

-- name: AddTunnelMinutes :exec
INSERT INTO usage_daily (org_id, day, tunnel_minutes)
VALUES ($1, sqlc.arg(day)::date, sqlc.arg(minutes)::bigint)
ON CONFLICT (org_id, day) DO UPDATE
SET tunnel_minutes = usage_daily.tunnel_minutes + EXCLUDED.tunnel_minutes;

-- name: SetRequestResponseStatus :exec
-- Records the status a CLI answered with in sync mode.
UPDATE request
SET response_status = sqlc.arg(status)::int
WHERE id = $1 AND received_at = sqlc.arg(received_at)::timestamptz;
