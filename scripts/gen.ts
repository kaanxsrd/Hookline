/**
 * bun run gen — regenerates every derived source file:
 *   - Go query layer (sqlc, from packages/db/migrations + packages/gocommon/dbq/queries)
 *
 * sqlc runs from its official Docker image because its PostgreSQL parser needs
 * cgo, which is not available everywhere (notably Windows). CI runs this and
 * fails when the committed output differs.
 */
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const SQLC_IMAGE = "sqlc/sqlc:1.31.1";

async function run(cmd: string[]): Promise<void> {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd[0]} exited with ${code}`);
}

function dockerUser(): string[] {
  // Keep generated files owned by the current user on Linux and macOS.
  if (process.platform === "win32" || !process.getuid || !process.getgid) return [];
  return ["--user", `${process.getuid()}:${process.getgid()}`];
}

async function sqlc(): Promise<void> {
  if (!Bun.which("docker")) {
    throw new Error("Docker is required to run sqlc (https://docs.docker.com/get-docker/).");
  }
  await run([
    "docker",
    "run",
    "--rm",
    ...dockerUser(),
    "-v",
    `${root}:/src`,
    "-w",
    "/src/packages/gocommon",
    SQLC_IMAGE,
    "generate",
  ]);
}

try {
  await sqlc();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
