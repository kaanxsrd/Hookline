-- name: GetEndpointForIntake :one
-- Everything intake needs to accept a request and answer the sender.
SELECT id, org_id, slug, status, response_mode, response_status, response_headers,
       response_body, response_delay_ms, sync_timeout_ms, signature_provider,
       signature_secret_enc, expires_at
FROM endpoint
WHERE slug = $1;
