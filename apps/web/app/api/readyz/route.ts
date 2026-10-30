import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

/**
 * Readiness probe: the web app can serve requests only with its database.
 * Redis is optional (live updates degrade), so it is not checked here.
 */
export async function GET(): Promise<Response> {
  try {
    await Promise.race([
      getDb().execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 2_000)),
    ]);
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const dynamic = "force-dynamic";
