import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { openapiDocument } from "@hookline/shared";
import { describe, expect, it } from "vitest";

/**
 * Static half of the contract tests: every operation in api/openapi.yaml has
 * a route handler, and every /api/v1 handler is documented. The Playwright
 * suite (e2e/api.spec.ts) validates the responses themselves.
 */

const API_DIR = join(__dirname, "../../app/api/v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Doc = { paths: Record<string, Record<string, unknown>> };
const doc = openapiDocument as unknown as Doc;

function routeFile(path: string): string {
  return join(API_DIR, path.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");
}

function exportedMethods(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return METHODS.filter((m) =>
    new RegExp(`export (const|async function|function) ${m}\\b`).test(source),
  );
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

describe("api/openapi.yaml ↔ app/api/v1", () => {
  const documented = Object.entries(doc.paths).flatMap(([path, ops]) =>
    Object.keys(ops)
      .filter((k) => METHODS.includes(k.toUpperCase() as (typeof METHODS)[number]))
      .map((m) => [path, m.toUpperCase()] as const),
  );

  it.each(documented)("%s %s has a handler", (path, method) => {
    const file = routeFile(path);
    expect(existsSync(file), `${relative(API_DIR, file)} is missing`).toBe(true);
    expect(exportedMethods(file)).toContain(method);
  });

  it("documents every handler", () => {
    for (const file of routeFiles(API_DIR)) {
      const path = `/${relative(API_DIR, file)
        .replace(/\\/g, "/")
        .replace(/\/?route\.ts$/, "")}`.replace(/\[(\w+)\]/g, "{$1}");
      const ops = doc.paths[path];
      expect(ops, `${path} is not in api/openapi.yaml`).toBeDefined();
      for (const method of exportedMethods(file)) {
        expect(Object.keys(ops ?? {}), `${method} ${path} is not documented`).toContain(
          method.toLowerCase(),
        );
      }
    }
  });

  it("gives every authenticated operation an error response", () => {
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (!METHODS.includes(method.toUpperCase() as (typeof METHODS)[number])) continue;
        const o = op as { security?: unknown[]; responses: Record<string, unknown> };
        if (Array.isArray(o.security) && o.security.length === 0) continue;
        expect(o.responses.default, `${method} ${path}`).toBeDefined();
      }
    }
  });
});
