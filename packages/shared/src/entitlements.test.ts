import { describe, expect, test } from "bun:test";
import { anonymousRules, limitsFor, resolvePlan, within } from "./entitlements";

describe("entitlements", () => {
  test("limits match the spec", () => {
    expect(limitsFor("free").endpoints).toBe(3);
    expect(limitsFor("pro").max_body_bytes).toBe(5 * 1024 * 1024);
    expect(limitsFor("team").members).toBeNull();
    expect(anonymousRules.max_requests).toBe(100);
  });

  test("within treats null as unlimited", () => {
    expect(within(3, 3)).toBe(true);
    expect(within(3, 4)).toBe(false);
    expect(within(null, 1e12)).toBe(true);
  });

  test("resolvePlan mirrors the Go implementation", () => {
    expect(resolvePlan({ instanceOverride: "unlimited", hasOrg: false })).toBe("unlimited");
    expect(resolvePlan({ hasOrg: false, plan: "team" })).toBe("anonymous");
    expect(resolvePlan({ hasOrg: true, plan: "free", planOverride: "team" })).toBe("team");
    expect(resolvePlan({ hasOrg: true, plan: "pro" })).toBe("pro");
    expect(resolvePlan({ hasOrg: true })).toBe("free");
    expect(resolvePlan({ hasOrg: true, plan: "platinum" })).toBe("free");
  });
});
