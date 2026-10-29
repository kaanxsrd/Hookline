/**
 * Cross-platform runner for the Go modules, used by their package.json scripts
 * so Turborepo can drive Go and TypeScript the same way.
 *
 *   bun scripts/go.ts setup             install the tools pinned in tools/go.mod into .tools/bin
 *   bun scripts/go.ts dev               hot reload the service in the cwd with air (loads the root .env)
 *   bun scripts/go.ts lint              golangci-lint run ./...
 *   bun scripts/go.ts test [go args]    go test ./..., with -race whenever cgo is available
 *   bun scripts/go.ts tool <name> ...   run any pinned tool
 *
 * Tools live in their own module outside go.work so their large dependency
 * graphs never leak into the services' build lists.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDotEnv } from "./lib/dotenv";

const root = resolve(import.meta.dir, "..");
const toolsModule = join(root, "tools");
const toolsHome = join(root, ".tools");
const binDir = join(toolsHome, "bin");
const stampFile = join(toolsHome, "stamp");
const lockDir = join(toolsHome, "lock");
const exe = process.platform === "win32" ? ".exe" : "";
const staleLockMs = 10 * 60 * 1000;

type Env = Record<string, string | undefined>;

async function run(cmd: string[], opts: { cwd?: string; env?: Env } = {}): Promise<number> {
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

async function output(cmd: string[], cwd = root): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "inherit" });
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
  return text.trim();
}

function requireGo(): void {
  if (Bun.which("go")) return;
  console.error(
    "Go is not installed or not on PATH. Install Go 1.27+ from https://go.dev/dl/ and retry.",
  );
  process.exit(1);
}

/** Binary names of the tools declared in tools/go.mod (`tool` directives). */
function toolNames(): string[] {
  const mod = readFileSync(join(toolsModule, "go.mod"), "utf8");
  const block = /^tool\s*\(([\s\S]*?)^\)/m.exec(mod)?.[1] ?? "";
  const single = [...mod.matchAll(/^tool\s+([^\s(]\S*)\s*$/gm)].map((m) => m[1] ?? "");
  const paths = [...block.split(/\r?\n/).map((l) => l.trim()), ...single].filter(Boolean);
  return paths.map((p) => {
    const parts = p.split("/");
    const last = parts.at(-1) ?? p;
    return /^v\d+$/.test(last) ? (parts.at(-2) ?? last) : last;
  });
}

async function toolsStamp(): Promise<string> {
  const hash = createHash("sha256");
  for (const f of ["go.mod", "go.sum"]) hash.update(readFileSync(join(toolsModule, f)));
  hash.update(await output(["go", "env", "GOVERSION"]));
  return hash.digest("hex");
}

function toolsCurrent(stamp: string): boolean {
  if (!existsSync(stampFile) || readFileSync(stampFile, "utf8") !== stamp) return false;
  return toolNames().every((name) => existsSync(join(binDir, name + exe)));
}

/** Installs pinned tools once; concurrent Turborepo tasks wait on a lock directory. */
async function ensureTools(): Promise<void> {
  requireGo();
  const stamp = await toolsStamp();
  if (toolsCurrent(stamp)) return;

  mkdirSync(toolsHome, { recursive: true });
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (existsSync(lockDir) && Date.now() - statSync(lockDir).mtimeMs > staleLockMs) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      await Bun.sleep(500);
    }
  }
  try {
    if (toolsCurrent(stamp)) return;
    console.error(`Installing Go tools (${toolNames().join(", ")}) into .tools/bin ...`);
    const code = await run(["go", "install", "tool"], {
      cwd: toolsModule,
      env: { ...process.env, GOBIN: binDir, GOWORK: "off" },
    });
    if (code !== 0) throw new Error("go install tool failed");
    writeFileSync(stampFile, stamp);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

async function tool(
  name: string,
  args: string[],
  opts: { cwd?: string; env?: Env } = {},
): Promise<number> {
  await ensureTools();
  const bin = join(binDir, name + exe);
  if (!existsSync(bin)) {
    console.error(`Unknown tool "${name}". Declared tools: ${toolNames().join(", ")}`);
    return 1;
  }
  return run([bin, ...args], opts);
}

/** The root .env merged under the real environment, which always wins. */
function devEnv(): Env {
  const file = join(root, ".env");
  if (!existsSync(file)) {
    console.error(
      "No .env found at the repository root; using defaults. Copy .env.example to .env.",
    );
    return process.env;
  }
  return { ...parseDotEnv(readFileSync(file, "utf8")), ...process.env };
}

async function raceSupported(): Promise<boolean> {
  const [cgo, cc] = (await output(["go", "env", "CGO_ENABLED", "CC"])).split(/\r?\n/);
  return cgo === "1" && !!cc && Bun.which(cc) !== null;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case "setup":
      await ensureTools();
      return 0;
    case "dev":
      // air watches paths relative to the repository root (see .air.toml).
      return tool("air", ["-c", join(process.cwd(), ".air.toml"), ...args], {
        cwd: root,
        env: devEnv(),
      });
    case "lint":
      // Turborepo lints several modules at once; golangci-lint locks by default.
      return tool("golangci-lint", [
        "run",
        "--allow-parallel-runners",
        ...(args.length ? args : ["./..."]),
      ]);
    case "test": {
      requireGo();
      const flags: string[] = [];
      if (await raceSupported()) {
        flags.push("-race");
      } else {
        console.warn("go test: no C compiler for cgo, running without -race (CI always uses it).");
      }
      return run(["go", "test", ...flags, ...(args.length ? args : ["./..."])]);
    }
    case "tool": {
      const [name, ...rest] = args;
      if (!name) break;
      return tool(name, rest);
    }
  }
  console.error("usage: bun scripts/go.ts <setup | dev | lint | test | tool <name>> [args...]");
  return 2;
}

process.exit(await main(process.argv.slice(2)));
