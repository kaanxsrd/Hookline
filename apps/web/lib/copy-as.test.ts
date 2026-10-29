import { describe, expect, it } from "vitest";
import { type CopyableRequest, toCurl, toFetch, toHttpie } from "./copy-as";

const req: CopyableRequest = {
  method: "POST",
  url: "https://hookline.example.com/h/abcdefABCDEF/stripe?x=1",
  headers: [
    ["Host", "hookline.example.com"],
    ["Content-Type", "application/json"],
    ["Content-Length", "15"],
    ["X-Quote", "it's"],
  ],
  bodyText: `{"it's":"ok"}`,
  hasBody: true,
};

describe("copy as", () => {
  it("builds a curl command with safe quoting and no transport headers", () => {
    expect(toCurl(req)).toBe(
      [
        "curl -X POST 'https://hookline.example.com/h/abcdefABCDEF/stripe?x=1'",
        "-H 'Content-Type: application/json'",
        `-H 'X-Quote: it'\\''s'`,
        `--data-raw '{"it'\\''s":"ok"}'`,
      ].join(" \\\n  "),
    );
  });

  it("builds a fetch call", () => {
    const code = toFetch(req);
    expect(code).toContain(
      'await fetch("https://hookline.example.com/h/abcdefABCDEF/stripe?x=1", {',
    );
    expect(code).toContain('"Content-Type": "application/json",');
    expect(code).toContain(`body: "{\\"it's\\":\\"ok\\"}",`);
    expect(code).not.toContain("Host");
  });

  it("builds an HTTPie command", () => {
    expect(toHttpie(req)).toBe(
      `printf %s '{"it'\\''s":"ok"}' | http POST 'https://hookline.example.com/h/abcdefABCDEF/stripe?x=1' \\\n  'Content-Type:application/json' \\\n  'X-Quote:it'\\''s'`,
    );
  });

  it("references a file for binary bodies and omits absent ones", () => {
    const binary = { ...req, bodyText: null };
    expect(toCurl(binary)).toContain("--data-binary @body.bin");
    expect(toHttpie(binary)).toMatch(/< body\.bin$/);
    const empty = { ...req, method: "GET", hasBody: false, bodyText: null };
    expect(toCurl(empty)).not.toContain("--data");
    expect(toFetch(empty)).not.toContain("body:");
  });
});
