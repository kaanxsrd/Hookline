/**
 * Integration tests against a real PostgreSQL. Each run creates a throwaway
 * database on the server in DATABASE_URL (the docker compose Postgres by
 * default), migrates it from scratch and drops it afterwards.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { createDatabase, type Database } from "./index";
import { runMigrations } from "./migrate";
import { account, endpoint, request, user } from "./schema";
import { SEED_ACCOUNTS, SEED_ENDPOINTS, seed } from "./seed/seed";
import { uuidv7 } from "./uuid";

const serverUrl =
  process.env.DATABASE_URL ?? "postgres://hookline:hookline@localhost:5433/hookline";
const dbName = `hookline_test_${randomBytes(6).toString("hex")}`;
const testUrl = (() => {
  const u = new URL(serverUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
let database: Database;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  database = createDatabase(testUrl, { max: 2 });
});

afterAll(async () => {
  await database?.close();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const scalar = async <T>(query: ReturnType<typeof sql>): Promise<T> => {
  const rows = (await database.db.execute(query)) as unknown as Record<string, T>[];
  const first = rows[0];
  if (!first) throw new Error("query returned no rows");
  return Object.values(first)[0] as T;
};

describe("migrations", () => {
  test("re-running is a no-op", async () => {
    await runMigrations(testUrl);
  });

  test("request is partitioned by day with partitions ahead of today", async () => {
    const strategy = await scalar<string>(
      sql`SELECT partstrat FROM pg_partitioned_table WHERE partrelid = 'request'::regclass`,
    );
    expect(strategy).toBe("r");
    const ahead = await scalar<number>(sql`
      SELECT count(*)::int FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'request'::regclass
        AND c.relname >= 'request_p' || to_char((now() AT TIME ZONE 'UTC')::date, 'YYYYMMDD')`);
    expect(ahead).toBeGreaterThanOrEqual(8);
  });

  test("uuidv7() produces version 7 UUIDs in time order", async () => {
    const [a, b] = [
      await scalar<string>(sql`SELECT uuidv7()`),
      await scalar<string>(sql`SELECT uuidv7()`),
    ];
    expect(a.charAt(14)).toBe("7");
    expect(a.charAt(19)).toMatch(/^[89ab]$/);
    expect(a < b).toBe(true);
  });

  test("updated_at is maintained by trigger", async () => {
    const [row] = await database.db
      .insert(user)
      .values({ name: "Trigger Test", email: "trigger@example.com" })
      .returning();
    if (!row) throw new Error("insert failed");
    await Bun.sleep(5);
    const [updated] = await database.db
      .update(user)
      .set({ name: "Trigger Test 2" })
      .where(eq(user.id, row.id))
      .returning();
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
    await database.db.delete(user).where(eq(user.id, row.id));
  });

  test("partition functions create and drop day partitions", async () => {
    const created = await scalar<number>(
      sql`SELECT hookline_ensure_request_partitions('2020-01-01', '2020-01-03')`,
    );
    expect(created).toBe(3);
    const again = await scalar<number>(
      sql`SELECT hookline_ensure_request_partitions('2020-01-01', '2020-01-03')`,
    );
    expect(again).toBe(0);

    const dropped = (await database.db.execute(
      sql`SELECT hookline_drop_request_partitions_before('2020-01-03') AS name`,
    )) as unknown as { name: string }[];
    expect(dropped.map((r) => r.name)).toEqual(["request_p20200101", "request_p20200102"]);
    await database.db.execute(sql`SELECT hookline_drop_request_partitions_before('2020-01-04')`);
  });

  test("inserts outside every partition fail loudly", async () => {
    const insert = async () =>
      database.db.execute(sql`
        INSERT INTO request (endpoint_id, method, path, received_at)
        VALUES (uuidv7(), 'POST', '/', '1999-01-01T00:00:00Z')`);
    const error = await insert().then(
      () => null,
      (e: unknown) => e,
    );
    // Drizzle wraps the driver error; the PostgreSQL message is the cause.
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).cause)).toMatch(/no partition of relation "request"/);
  });
});

describe("seed", () => {
  const counts = async () =>
    Object.fromEntries(
      await Promise.all(
        [
          "user",
          "account",
          "organization",
          "member",
          "subscription",
          "endpoint",
          "request",
          "destination",
          "delivery",
          "delivery_attempt",
          "usage_daily",
          "audit_log",
        ].map(async (t) => [t, await scalar<number>(sql.raw(`SELECT count(*)::int FROM "${t}"`))]),
      ),
    );

  test("creates realistic data and is idempotent", async () => {
    const first = await seed(database.db, { password: "test-password-123" });
    expect(first.usersCreated).toBe(2);
    expect(first.endpointsCreated).toBe(SEED_ENDPOINTS.length);
    expect(first.requestsCreated).toBe(SEED_ENDPOINTS.reduce((n, e) => n + e.requests, 0));
    expect(first.deliveriesCreated).toBeGreaterThan(0);
    const before = await counts();

    const second = await seed(database.db, { password: "test-password-123" });
    expect(second).toMatchObject({
      orgId: first.orgId,
      adminUserId: first.adminUserId,
      usersCreated: 0,
      endpointsCreated: 0,
      requestsCreated: 0,
      deliveriesCreated: 0,
    });
    expect(await counts()).toEqual(before);
  });

  test("seeded admin can sign in with the seed password", async () => {
    const [row] = await database.db
      .select({ hash: account.password, isAdmin: user.isAdmin })
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(and(eq(user.email, SEED_ACCOUNTS.admin.email), eq(account.providerId, "credential")));
    expect(row?.isAdmin).toBe(true);
    expect(await verifyPassword({ hash: row?.hash ?? "", password: "test-password-123" })).toBe(
      true,
    );
  });

  test("request IDs carry their received_at timestamp", async () => {
    const rows = await database.db
      .select({ id: request.id, receivedAt: request.receivedAt, slug: endpoint.slug })
      .from(request)
      .innerJoin(endpoint, eq(endpoint.id, request.endpointId))
      .limit(20);
    expect(rows.length).toBe(20);
    for (const r of rows) {
      const ms = Number.parseInt(r.id.replaceAll("-", "").slice(0, 12), 16);
      expect(ms).toBe(r.receivedAt.getTime());
    }
  });

  test("seeded bodies are searchable through the trigram projection", async () => {
    const n = await scalar<number>(sql`
      SELECT count(*)::int FROM request
      WHERE body_inline IS NOT NULL
        AND encode(body_inline, 'escape') ILIKE '%' || encode(convert_to('payment_intent', 'UTF8'), 'escape') || '%'`);
    expect(n).toBeGreaterThan(0);
  });
});

describe("uuidv7 (TypeScript)", () => {
  test("encodes the given time, version and variant", () => {
    const at = new Date("2026-01-02T03:04:05.678Z");
    const id = uuidv7(at);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)).toBe(at.getTime());
  });
});
