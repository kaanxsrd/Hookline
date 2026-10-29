import { describe, expect, it } from "vitest";
import { bodyText, detectKind, formatBytes, hexDump, parseForm, prettyXml } from "./body";

const enc = (s: string) => new TextEncoder().encode(s);

describe("detectKind", () => {
  it.each([
    ["", undefined, "empty"],
    ['{"a":1}', "application/json", "json"],
    ["[1,2]", undefined, "json"],
    ["{oops", "application/json", "text"],
    ["a=1&b=2", "application/x-www-form-urlencoded", "form"],
    ['<?xml version="1.0"?><a/>', undefined, "xml"],
    ["<note><to>x</to></note>", "text/plain", "xml"],
    ["<script>alert(1)</script>", "text/html", "xml"],
    ["hello", "text/plain", "text"],
  ])("%j (%s) -> %s", (body, ct, kind) => {
    expect(detectKind(enc(body), ct)).toBe(kind);
  });

  it("treats invalid UTF-8 and control characters as binary", () => {
    expect(detectKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png")).toBe("binary");
    expect(detectKind(enc("a\u0000b"), "text/plain")).toBe("binary");
    expect(bodyText(enc("tab\tand\nnewline"))).toBe("tab\tand\nnewline");
  });
});

describe("parseForm", () => {
  it("keeps order, repeats and decoding", () => {
    expect(parseForm("a=1&b=two+words&a=%26")).toEqual([
      ["a", "1"],
      ["b", "two words"],
      ["a", "&"],
    ]);
  });
});

describe("prettyXml", () => {
  it("indents nested elements and keeps text inline", () => {
    expect(prettyXml("<a><b>x</b><c><d/></c></a>")).toBe(
      ["<a>", "  <b>x</b>", "  <c>", "    <d/>", "  </c>", "</a>"].join("\n"),
    );
  });

  it("keeps declarations and attributes", () => {
    expect(prettyXml('<?xml version="1.0"?><n id="1"><t>v</t></n>')).toBe(
      ['<?xml version="1.0"?>', '<n id="1">', "  <t>v</t>", "</n>"].join("\n"),
    );
  });
});

describe("hexDump", () => {
  it("formats offsets, bytes and ASCII", () => {
    const { text, truncated } = hexDump(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    expect(text).toBe(`00000000  89 50 4e 47 00 01${" ".repeat(30)}  .PNG..`);
    expect(truncated).toBe(false);
    expect(hexDump(new Uint8Array(20), 16).truncated).toBe(true);
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
