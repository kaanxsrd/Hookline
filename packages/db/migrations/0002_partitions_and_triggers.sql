-- Hand-written: request partition management, body search index and
-- updated_at triggers. None of these can be expressed in Drizzle.

-- Creates one partition of "request" per UTC day in [p_from, p_to] and
-- returns how many were created. Safe to call concurrently: callers are
-- serialized by an advisory lock and existing partitions are skipped.
-- The worker calls this hourly (7 days ahead); the edge calls it when an
-- insert finds no partition.
CREATE OR REPLACE FUNCTION hookline_ensure_request_partitions(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  d date := p_from;
  part text;
  created integer := 0;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'p_to (%) is before p_from (%)', p_to, p_from;
  END IF;
  IF p_to - p_from > 400 THEN
    RAISE EXCEPTION 'refusing to create more than 400 partitions at once';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hookline_request_partitions'));
  WHILE d <= p_to LOOP
    part := 'request_p' || to_char(d, 'YYYYMMDD');
    IF to_regclass(format('public.%I', part)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.request FOR VALUES FROM (%L) TO (%L)',
        part,
        d::timestamp AT TIME ZONE 'UTC',
        (d + 1)::timestamp AT TIME ZONE 'UTC'
      );
      created := created + 1;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN created;
END;
$$;
--> statement-breakpoint

-- Drops every daily partition that ends on or before p_before (UTC), i.e.
-- all requests received before p_before 00:00 UTC, and returns their names.
-- Deliveries are not cascaded: the caller deletes them first.
CREATE OR REPLACE FUNCTION hookline_drop_request_partitions_before(p_before date)
RETURNS SETOF text
LANGUAGE plpgsql
AS $$
DECLARE
  part record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hookline_request_partitions'));
  FOR part IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.request'::regclass
      AND c.relname ~ '^request_p[0-9]{8}$'
      AND to_date(substring(c.relname FROM 10), 'YYYYMMDD') < p_before
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TABLE public.%I', part.relname);
    RETURN NEXT part.relname;
  END LOOP;
END;
$$;
--> statement-breakpoint

SELECT hookline_ensure_request_partitions(
  (now() AT TIME ZONE 'UTC')::date - 1,
  (now() AT TIME ZONE 'UTC')::date + 7
);
--> statement-breakpoint

-- Full-text-ish search over inline bodies (at most 64 KiB each). encode(...,
-- 'escape') is immutable and never fails on invalid UTF-8; queries escape the
-- search term the same way: encode(convert_to(term, 'UTF8'), 'escape').
CREATE INDEX request_body_trgm_idx ON request
  USING gin ((encode(body_inline, 'escape')) gin_trgm_ops)
  WHERE body_inline IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER user_set_updated_at BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER session_set_updated_at BEFORE UPDATE ON session
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER account_set_updated_at BEFORE UPDATE ON account
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER verification_set_updated_at BEFORE UPDATE ON verification
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER organization_set_updated_at BEFORE UPDATE ON organization
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
-- Settings changes only: request_count and last_request_at are excluded so
-- counter updates do not bump updated_at.
CREATE TRIGGER endpoint_set_updated_at BEFORE UPDATE OF
    org_id, slug, name, description, status, disabled_reason,
    response_mode, response_status, response_headers, response_body,
    response_delay_ms, sync_timeout_ms, signature_provider, signature_secret_enc,
    retention_hours, anonymous_view_token_hash, anonymous_creator_ip, expires_at
  ON endpoint
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER destination_set_updated_at BEFORE UPDATE ON destination
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER delivery_set_updated_at BEFORE UPDATE ON delivery
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER api_key_set_updated_at BEFORE UPDATE ON api_key
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER cli_device_code_set_updated_at BEFORE UPDATE ON cli_device_code
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER usage_daily_set_updated_at BEFORE UPDATE ON usage_daily
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER subscription_set_updated_at BEFORE UPDATE ON subscription
  FOR EACH ROW EXECUTE FUNCTION hookline_set_updated_at();
