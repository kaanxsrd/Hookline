import { describe, expect, it } from "vitest";
import { open, parseKeys, seal } from "./secretbox";

const k1 = "k1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const k0 = "k0:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=";
// The vector packages/gocommon/secretbox opens in its tests.
const VECTOR = "hlenc:v1:k1:AAECAwQFBgcICQoLL2e6d6pAC3GXju-k7PvPr6X_Pzr8";

describe("secretbox", () => {
  it("matches the Go implementation", () => {
    const keys = parseKeys(k1);
    const nonce = Buffer.from("000102030405060708090a0b", "hex");
    expect(seal(keys, "hello", "destination.signing_secret:abc", nonce)).toBe(VECTOR);
    expect(open(keys, VECTOR, "destination.signing_secret:abc")).toBe("hello");
  });

  it("binds the context and rejects tampering", () => {
    const keys = parseKeys(k1);
    const env = seal(keys, "s", "ctx:1");
    expect(() => open(keys, env, "ctx:2")).toThrow();
    expect(() => open(keys, `${env.slice(0, -2)}AA`, "ctx:1")).toThrow();
    expect(() => open(keys, "plain", "ctx:1")).toThrow();
  });

  it("rotates keys", () => {
    const env = seal(parseKeys(k0), "legacy", "ctx");
    const rotated = parseKeys(`${k1},${k0}`);
    expect(open(rotated, env, "ctx")).toBe("legacy");
    expect(seal(rotated, "new", "ctx")).toContain(":k1:");
  });

  it("validates keys", () => {
    expect(() => parseKeys("")).toThrow();
    expect(() => parseKeys("k1:AAAA")).toThrow();
  });
});
