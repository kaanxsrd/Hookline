import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };

export type Database = ReturnType<typeof createDatabase>;
export type Db = Database["db"];

/** Opens a connection pool and a typed Drizzle client over it. Call close() on shutdown. */
export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    // Notices (e.g. "relation already exists, skipping") are not errors.
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}

export { uuidv7 } from "./uuid";
