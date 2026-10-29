-- name: GetAPIKeyByHash :one
-- Looks up a presented key by its SHA-256. Revoked and expired keys are filtered here
-- so callers cannot forget to; the comparison on the unique hash index is exact.
SELECT id, org_id, name, prefix, scopes, expires_at
FROM api_key
WHERE hash = $1
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now());

-- name: TouchAPIKey :exec
-- Records use at most once a minute to avoid a write per request.
UPDATE api_key
SET last_used_at = now()
WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
