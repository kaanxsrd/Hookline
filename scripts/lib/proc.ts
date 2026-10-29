import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDotEnv } from "./dotenv";

export const repoRoot = resolve(import.meta.dir, "..", "..");

export type Env = Record<string, string | undefined>;

/** The root .env merged under the real environment, which always wins. */
export function rootEnv(): Env {
  const file = join(repoRoot, ".env");
  if (!existsSync(file)) {
    console.error(
      "No .env found at the repository root; using defaults. Copy .env.example to .env.",
    );
    return process.env;
  }
  return { ...parseDotEnv(readFileSync(file, "utf8")), ...process.env };
}

/** Runs cmd with inherited stdio and resolves with its exit code. */
export async function run(cmd: string[], opts: { cwd?: string; env?: Env } = {}): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? process.cwd(),
    env: opts.env ?? process.env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  // Ctrl+C reaches the child through the terminal; stay alive until it exits
  // so it can shut down gracefully.
  const ignore = () => {};
  process.on("SIGINT", ignore);
  process.on("SIGTERM", ignore);
  try {
    return await proc.exited;
  } finally {
    process.off("SIGINT", ignore);
    process.off("SIGTERM", ignore);
  }
}
