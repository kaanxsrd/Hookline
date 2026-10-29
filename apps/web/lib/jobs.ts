import "server-only";
import type { Db } from "@hookline/db";
import { sql } from "drizzle-orm";

/** River queue and kind the worker's delivery worker consumes (packages/gocommon/jobs). */
const DELIVERIES_QUEUE = "deliveries";
const DELIVER_KIND = "deliver";
const DELIVER_MAX_ATTEMPTS = 5;

type Executor = Pick<Db, "execute">;

/**
 * Enqueues a River "deliver" job per delivery. Pass the transaction that
 * created the deliveries so a rollback drops the jobs too. River normally
 * inserts jobs itself; this is the equivalent insert plus the LISTEN/NOTIFY
 * wake-up its clients send, so workers pick the jobs up immediately.
 */
export async function enqueueDeliveries(db: Executor, deliveryIds: string[]): Promise<void> {
  if (deliveryIds.length === 0) return;
  const args = deliveryIds.map((id) => JSON.stringify({ delivery_id: id }));
  await db.execute(sql`
    INSERT INTO river_job (args, kind, max_attempts, queue, state, scheduled_at)
    SELECT a::jsonb, ${DELIVER_KIND}, ${DELIVER_MAX_ATTEMPTS}, ${DELIVERIES_QUEUE}, 'available', now()
    FROM unnest(${sql.raw("ARRAY[")}${sql.join(
      args.map((a) => sql`${a}`),
      sql`, `,
    )}${sql.raw("]::text[]")}) AS a`);
  await db.execute(
    sql`SELECT pg_notify(current_schema() || '.river_insert', ${JSON.stringify({ queue: DELIVERIES_QUEUE })})`,
  );
}
