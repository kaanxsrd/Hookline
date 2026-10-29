/**
 * bun scripts/with-env.ts <command> [args...]
 *
 * Runs a command with the repository's root .env loaded (real environment
 * variables win). Used by apps/web: Next.js only reads .env files from its
 * own directory and resets process.env before rendering, so the variables
 * have to be present when the process starts.
 */
import { rootEnv, run } from "./lib/proc";

const cmd = process.argv.slice(2);
if (cmd.length === 0) {
  console.error("usage: bun scripts/with-env.ts <command> [args...]");
  process.exit(2);
}
process.exit(await run(cmd, { env: rootEnv() }));
