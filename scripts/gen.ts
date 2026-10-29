/**
 * bun run gen — regenerates every derived source file:
 *   - entitlements for Go and TypeScript (from config/plans.json)
 *   - Go query layer (sqlc, from packages/db/migrations + packages/gocommon/dbq/queries)
 *   - API types for TypeScript (openapi-typescript) and Go (oapi-codegen), and the
 *     OpenAPI document as a module, all from api/openapi.yaml
 *
 * sqlc runs from its official Docker image because its PostgreSQL parser needs
 * cgo, which is not available everywhere (notably Windows). CI runs this and
 * fails when the committed output differs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { renderGo, renderTs, validatePlans } from "./lib/plans";

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

async function entitlements(): Promise<void> {
  const plans = validatePlans(JSON.parse(readFileSync(join(root, "config/plans.json"), "utf8")));
  const goFile = join(root, "packages/gocommon/entitlements/plans_gen.go");
  const tsFile = join(root, "packages/shared/src/entitlements.gen.ts");
  writeFileSync(goFile, renderGo(plans));
  writeFileSync(tsFile, renderTs(plans));
  console.log("entitlements: wrote plans_gen.go and entitlements.gen.ts");
  await run(["gofmt", "-w", goFile]);
  await run(["bunx", "biome", "format", "--write", tsFile]);
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

async function openapi(): Promise<void> {
  const spec = "api/openapi.yaml";
  const typesFile = "packages/shared/src/api.gen.ts";
  const docFile = "packages/shared/src/openapi.gen.ts";
  await run(["bunx", "openapi-typescript", spec, "--output", typesFile]);
  const doc: unknown = parse(readFileSync(join(root, spec), "utf8"));
  writeFileSync(
    join(root, docFile),
    `// Code generated from ${spec} by \`bun run gen\`. DO NOT EDIT.

` +
      `/** The OpenAPI document, served at /api/v1/openapi.json and rendered at /docs/api. */
` +
      `export const openapiDocument: Record<string, unknown> = ${JSON.stringify(doc)};
`,
  );
  await run(["bunx", "biome", "format", "--write", typesFile, docFile]);
  await run([
    "bun",
    "scripts/go.ts",
    "tool",
    "oapi-codegen",
    "-config",
    "cli/internal/api/oapi-codegen.yaml",
    spec,
  ]);
}

try {
  await entitlements();
  await sqlc();
  await openapi();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
