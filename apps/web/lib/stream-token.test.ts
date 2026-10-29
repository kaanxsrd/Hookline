import { describe, expect, it } from "vitest";
import { signStreamToken } from "./stream-token";

// The same token is the fixture in services/edge/internal/streamauth/streamauth_test.go,
// which proves the edge accepts what the web app signs.
const FIXTURE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmciOiJvcmctMSIsImVwIjoiMDE4ZjAwMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiYXVkIjoiaG9va2xpbmUtc3RyZWFtIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMDAzMDB9.JxEJ7-2pFEGyUQi5jrdX0o3Qz2Q6nnovUloEaK_a5mY";

describe("signStreamToken", () => {
  it("matches the Go verifier's fixture", () => {
    expect(
      signStreamToken(
        "test-stream-secret-0123456789abcdef",
        { sub: "user-1", org: "org-1", ep: "018f0000-0000-7000-8000-000000000001" },
        1_700_000_000,
      ),
    ).toBe(FIXTURE);
  });

  it("refuses short secrets", () => {
    expect(() => signStreamToken("short", { sub: "a", org: "", ep: "b" })).toThrow();
  });
});
