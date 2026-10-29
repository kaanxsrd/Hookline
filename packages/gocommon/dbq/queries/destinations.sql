-- name: ListEnabledDestinations :many
-- Destinations that may receive a newly captured request; filters are applied in Go.
SELECT id, endpoint_id, name, url, filter, extra_headers, timeout_ms, max_attempts,
       sign_with_standard_webhooks, signing_secret_enc
FROM destination
WHERE endpoint_id = $1 AND enabled
ORDER BY created_at;
