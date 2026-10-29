-- Hand-written: functions and extensions every later migration relies on.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- UUIDv7 (RFC 9562): 48-bit Unix millisecond timestamp, version and variant
-- bits, the rest random. PostgreSQL 18 ships uuidv7() in pg_catalog, which is
-- searched first, so this definition is simply unused there.
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;
--> statement-breakpoint

-- Keeps updated_at current no matter which service (Go or TypeScript) writes.
CREATE OR REPLACE FUNCTION hookline_set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
