import { defineConfig } from "drizzle-kit";

// Paths are relative to packages/db; drizzle-kit is always run from there
// (see the db:* scripts). Absolute Windows paths break drizzle-kit's globbing.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://hookline:hookline@localhost:5433/hookline",
  },
  // River's tables come from a hand-written migration and are not modelled in Drizzle.
  tablesFilter: ["!river_*"],
  strict: true,
  verbose: true,
});
