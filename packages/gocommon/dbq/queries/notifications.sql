-- name: ClaimNotification :one
-- Records that a notification is being sent. Returns no row when the same key
-- was sent within the window, so callers send at most once per window.
INSERT INTO notification_log (key, org_id)
VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE SET sent_at = now()
WHERE notification_log.sent_at < now() - sqlc.arg(window_)::interval
RETURNING id;

-- name: ReleaseNotification :exec
-- Undoes a claim whose email could not be sent, so it is retried.
DELETE FROM notification_log WHERE id = $1;

-- name: ListOrgAdminEmails :many
-- Owners and admins receive operational notifications.
SELECT u.email
FROM member m
JOIN "user" u ON u.id = m.user_id
WHERE m.organization_id = $1 AND m.role IN ('owner', 'admin')
ORDER BY u.email;

-- name: GetDestinationNotice :one
-- What a "deliveries are failing" email names.
SELECT dst.name AS destination_name, dst.url AS destination_url,
       e.name AS endpoint_name, e.slug AS endpoint_slug,
       o.id AS org_id, o.name AS org_name, o.slug AS org_slug
FROM destination dst
JOIN endpoint e ON e.id = dst.endpoint_id
JOIN organization o ON o.id = e.org_id
WHERE dst.id = $1;

-- name: ListMonthUsage :many
-- Requests per organization since the first day of the month, with its plan.
SELECT u.org_id, o.name AS org_name, o.slug AS org_slug, s.plan, s.plan_override,
       sum(u.requests)::bigint AS requests
FROM usage_daily u
JOIN organization o ON o.id = u.org_id
LEFT JOIN subscription s ON s.org_id = u.org_id
WHERE u.day >= sqlc.arg(month_start)::date
GROUP BY u.org_id, o.name, o.slug, s.plan, s.plan_override;

-- name: CountOrgRequestsThisMonth :one
-- Seeds the edge's monthly quota counter: rolled-up past days plus today's rows.
SELECT (
  coalesce((SELECT sum(ud.requests) FROM usage_daily ud
            WHERE ud.org_id = sqlc.arg(org_id)::uuid AND ud.day >= sqlc.arg(month_start)::date
              AND ud.day < sqlc.arg(today)::date), 0)
  + (SELECT count(*) FROM request r
     WHERE r.org_id = sqlc.arg(org_id)::uuid AND r.received_at >= sqlc.arg(today)::date)
)::bigint AS requests;
