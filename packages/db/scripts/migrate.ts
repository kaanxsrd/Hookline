/** bun run db:migrate — applies pending migrations to DATABASE_URL. */
import { runMigrations } from "../src/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env at the repository root.");
  process.exit(1);
}

await runMigrations(url);
console.log("Migrations applied.");
