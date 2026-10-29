import { describe, expect, it } from "vitest";
import { childPath } from "./json-tree";

describe("childPath", () => {
  it("builds JSONPath segments", () => {
    expect(childPath("$", "data")).toBe("$.data");
    expect(childPath("$.data", 0)).toBe("$.data[0]");
    expect(childPath("$", "weird key")).toBe('$["weird key"]');
    expect(childPath("$", "x-y")).toBe('$["x-y"]');
    expect(childPath("$", "_ok$1")).toBe("$._ok$1");
  });
});
