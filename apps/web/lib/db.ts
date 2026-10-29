import "server-only";
import { createDatabase, type Database } from "@hookline/db";
import { env } from "./env";

// One pool per server process. Development hot reloads re-evaluate modules,
// so the instance lives on globalThis to avoid leaking connections.
const globalForDb = globalThis as typeof globalThis & { __hooklineDb?: Database };

export function getDb(): Database["db"] {
  globalForDb.__hooklineDb ??= createDatabase(env().DATABASE_URL, { max: 10 });
  return globalForDb.__hooklineDb.db;
}
