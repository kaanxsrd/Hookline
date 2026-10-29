import { describe, expect, it } from "vitest";
import { hasRole, roles, validOrgSlug } from "./permissions";

describe("roles", () => {
  it("ranks roles", () => {
    expect(hasRole("owner", "admin")).toBe(true);
    expect(hasRole("admin", "admin")).toBe(true);
    expect(hasRole("member", "admin")).toBe(false);
    expect(hasRole("viewer", "member")).toBe(false);
    expect(hasRole("superuser", "viewer")).toBe(false);
  });

  it("grants Better Auth permissions consistently with the ranks", () => {
    expect(roles.viewer.authorize({ endpoint: ["read"] }).success).toBe(true);
    expect(roles.viewer.authorize({ endpoint: ["create"] }).success).toBe(false);
    expect(roles.member.authorize({ request: ["reveal"] }).success).toBe(true);
    expect(roles.member.authorize({ invitation: ["create"] }).success).toBe(false);
    expect(roles.admin.authorize({ invitation: ["create"], apiKey: ["create"] }).success).toBe(
      true,
    );
    expect(roles.admin.authorize({ organization: ["delete"] }).success).toBe(false);
    expect(roles.owner.authorize({ organization: ["delete"], billing: ["manage"] }).success).toBe(
      true,
    );
  });
});

describe("validOrgSlug", () => {
  it.each(["acme", "acme-labs", "a1b", "x".repeat(40)])("accepts %s", (slug) => {
    expect(validOrgSlug(slug)).toBe(true);
  });
  it.each(["ab", "Acme", "-acme", "acme-", "ac--me", "acme_labs", "x".repeat(41), "new", "api"])(
    "rejects %s",
    (slug) => {
      expect(validOrgSlug(slug)).toBe(false);
    },
  );
});
