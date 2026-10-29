import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type APIResponse, expect } from "@playwright/test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse } from "yaml";

/**
 * Validates API responses against api/openapi.yaml (the runtime half of the
 * contract tests; lib/api/contract.test.ts checks handlers exist).
 */

type Op = { responses: Record<string, Response | { $ref: string }> };
type Response = { content?: Record<string, { schema?: unknown }> };
type Doc = {
  paths: Record<string, Record<string, Op>>;
  components: Record<string, Record<string, unknown>>;
};

const doc = parse(readFileSync(resolve(__dirname, "../../../api/openapi.yaml"), "utf8")) as Doc;

/** OpenAPI 3.0 schemas → JSON Schema: `nullable` becomes `anyOf [..., null]`, refs point at the document. */
function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (node === null || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "nullable" || k === "example") continue;
    out[k] =
      k === "$ref" && typeof v === "string" ? v.replace(/^#/, "openapi.json#") : toJsonSchema(v);
  }
  return obj.nullable === true ? { anyOf: [out, { type: "null" }] } : out;
}

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: "openapi.json", components: toJsonSchema(doc.components) });

/** Operations validated so far ("get /endpoints"). */
export const covered = new Set<string>();

export const operations = Object.entries(doc.paths).flatMap(([path, ops]) =>
  Object.keys(ops)
    .filter((m) => ["get", "post", "patch", "delete", "put"].includes(m))
    .map((m) => `${m} ${path}`),
);

function resolveResponse(r: Response | { $ref: string }): Response {
  if ("$ref" in r) {
    const name = r.$ref.split("/").pop() ?? "";
    return doc.components.responses?.[name] as Response;
  }
  return r;
}

/** Asserts the response matches the documented status and schema. */
export async function expectContract(
  res: APIResponse,
  method: string,
  path: string,
): Promise<void> {
  const op = doc.paths[path]?.[method];
  expect(op, `${method} ${path} is documented`).toBeDefined();
  const status = String(res.status());
  const documented = op?.responses[status] ?? op?.responses.default;
  expect(
    documented,
    `${method.toUpperCase()} ${path} answered undocumented ${status}`,
  ).toBeDefined();
  covered.add(`${method} ${path}`);
  if (!documented) return;
  const response = resolveResponse(documented);
  const schema = response.content?.["application/json"]?.schema;
  if (!schema) return;
  expect(res.headers()["content-type"]).toContain("application/json");
  const validate = ajv.compile(toJsonSchema(schema) as object);
  const body: unknown = await res.json();
  const valid = validate(body);
  expect(
    valid,
    `${method.toUpperCase()} ${path} ${status}: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body).slice(0, 500)}`,
  ).toBe(true);
}
