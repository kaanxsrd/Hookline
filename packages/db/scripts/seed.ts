/** bun run db:seed — loads development data. Safe to run repeatedly. */
import { createDatabase } from "../src/index";
import { SEED_ACCOUNTS, SEED_ORG, seed } from "../src/seed/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env at the repository root.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") {
  console.error(
    "Refusing to seed with NODE_ENV=production (set SEED_ALLOW_PRODUCTION=true to override).",
  );
  process.exit(1);
}

const password = process.env.SEED_PASSWORD ?? "hookline-dev-password";
const database = createDatabase(url, { max: 1 });
try {
  const summary = await seed(database.db, { password });
  console.log(
    `Seeded: ${summary.usersCreated} users, ${summary.endpointsCreated} endpoints, ` +
      `${summary.requestsCreated} requests, ${summary.deliveriesCreated} deliveries created.`,
  );
  console.log(`Organization: ${SEED_ORG.name} (/${SEED_ORG.slug})`);
  for (const { email } of Object.values(SEED_ACCOUNTS)) {
    console.log(`Sign in: ${email} / ${password}`);
  }
} finally {
  await database.close();
}
