import { describe, expect, it } from "vitest";
import { matchesHash, newSlug, newToken, randomBase62, sha256 } from "./random";

describe("random", () => {
  it("makes 12-character base62 slugs", () => {
    for (let i = 0; i < 200; i++) expect(newSlug()).toMatch(/^[0-9A-Za-z]{12}$/);
  });

  it("is roughly uniform over the alphabet", () => {
    const counts = new Map<string, number>();
    for (const c of randomBase62(62_000)) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(62);
    for (const n of counts.values()) expect(n).toBeGreaterThan(700);
  });

  it("makes 43-character base64url tokens", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });

  it("matches tokens against stored hashes", () => {
    const token = newToken();
    expect(matchesHash(token, sha256(token))).toBe(true);
    expect(matchesHash(`${token}x`, sha256(token))).toBe(false);
    expect(matchesHash(token, null)).toBe(false);
    expect(matchesHash(token, new Uint8Array(4))).toBe(false);
  });
});
