import { limitsFor } from "@hookline/shared";
import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatLimit,
  formatRetention,
  planFeatures,
  planLimitRows,
} from "./plan-features";

describe("plan formatting", () => {
  it("formats limits, retention and sizes", () => {
    expect(formatLimit(5000, "requests a month")).toBe("5,000 requests a month");
    expect(formatLimit(null, "members")).toBe("Unlimited members");
    expect(formatRetention(24)).toBe("24 hours");
    expect(formatRetention(336)).toBe("14 days");
    expect(formatBytes(262144)).toBe("256 KiB");
    expect(formatBytes(5242880)).toBe("5 MiB");
  });

  it("describes every subscribable plan from plans.json", () => {
    for (const plan of ["free", "pro", "team"] as const) {
      expect(planFeatures(plan)).toHaveLength(6);
      const rows = planLimitRows(limitsFor(plan));
      expect(rows.map(([label]) => label)).toContain("Requests per month");
      expect(rows.every(([, value]) => value.length > 0)).toBe(true);
    }
    expect(planLimitRows(limitsFor("free")).find(([l]) => l === "Audit log")?.[1]).toBe("—");
    expect(planLimitRows(limitsFor("team")).find(([l]) => l === "Members")?.[1]).toBe("Unlimited");
  });
});
