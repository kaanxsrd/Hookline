import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SIGNATURE_PROVIDERS, type SignatureProvider, verifySignature } from "./signatures";

type Vector = {
  name: string;
  provider: SignatureProvider;
  secret: string;
  headers: [string, string][];
  body: string;
  now: number;
  expect: "verified" | "invalid";
  reason?: string;
};

const { vectors } = JSON.parse(
  readFileSync(join(__dirname, "../../../packages/shared/fixtures/signature-vectors.json"), "utf8"),
) as { vectors: Vector[] };

describe("shared signature vectors", () => {
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    const result = verifySignature(v.provider, v.secret, {
      headers: v.headers,
      body: new TextEncoder().encode(v.body),
      now: new Date(v.now * 1000),
    });
    if (v.expect === "verified") {
      expect(result).toEqual({ verified: true });
    } else {
      expect(result.verified).toBe(false);
      if (!result.verified) expect(result.reason).toBe(v.reason);
    }
  });

  it("covers every provider", () => {
    for (const p of SIGNATURE_PROVIDERS) {
      expect(vectors.some((v) => v.provider === p && v.expect === "verified")).toBe(true);
    }
  });
});
