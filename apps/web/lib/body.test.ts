import { describe, expect, it } from "vitest";
import { describeBody, formatBytes } from "./body";

const enc = (s: string) => new TextEncoder().encode(s);

describe("describeBody", () => {
  it("handles empty bodies", () => {
    expect(describeBody(null, null)).toEqual({ kind: "empty" });
    expect(describeBody(new Uint8Array(), "text/plain")).toEqual({ kind: "empty" });
  });

  it("pretty-prints JSON by content type or shape", () => {
    expect(describeBody(enc('{"a":1}'), "application/json")).toEqual({
      kind: "json",
      text: '{\n  "a": 1\n}',
    });
    expect(describeBody(enc("[1]"), null)).toMatchObject({ kind: "json" });
  });

  it("falls back to text for invalid JSON and HTML", () => {
    expect(describeBody(enc("{oops"), "application/json")).toEqual({ kind: "text", text: "{oops" });
    expect(describeBody(enc("<script>x</script>"), "text/html")).toEqual({
      kind: "text",
      text: "<script>x</script>",
    });
  });

  it("shows binary as a hex dump", () => {
    const view = describeBody(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]), "image/png");
    expect(view.kind).toBe("binary");
    if (view.kind === "binary") {
      expect(view.hex).toBe(`00000000  89 50 4e 47 00 01${" ".repeat(30)}  .PNG..`);
      expect(view.truncated).toBe(false);
    }
    expect(describeBody(enc("a\u0000b"), "text/plain").kind).toBe("binary");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1536, "1.5 KB"],
    [262_144, "256 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
  ])("%d -> %s", (n, want) => {
    expect(formatBytes(n)).toBe(want);
  });
});
