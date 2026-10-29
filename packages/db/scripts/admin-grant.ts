/**
 * bun run admin:grant <email> [--revoke] — makes an existing user an instance
 * administrator (or stops them being one). The first administrator has to be
 * made this way; after that, administrators manage each other in /admin.
 */
import { eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "../src/index";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = args
  .find((a) => !a.startsWith("--"))
  ?.trim()
  .toLowerCase();

if (!email) {
  console.error("Usage: bun run admin:grant <email> [--revoke]");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env at the repository root.");
  process.exit(1);
}

const database = createDatabase(url, { max: 1 });
try {
  const [user] = await database.db
    .update(schema.user)
    .set({ isAdmin: !revoke })
    .where(eq(sql`lower(${schema.user.email})`, email))
    .returning({ id: schema.user.id, name: schema.user.name });
  if (!user) {
    console.error(`No account uses ${email}. Sign up first, then run this again.`);
    process.exitCode = 1;
  } else {
    await database.db.insert(schema.auditLog).values({
      orgId: null,
      action: revoke ? "admin.user.admin_revoked" : "admin.user.admin_granted",
      targetType: "user",
      targetId: user.id,
      metadata: { email, via: "cli" },
    });
    console.log(
      revoke
        ? `${user.name} <${email}> is no longer an administrator.`
        : `${user.name} <${email}> is now an administrator: /admin is open to them.`,
    );
  }
} finally {
  await database.close();
}
