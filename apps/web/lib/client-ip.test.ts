import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

describe("clientIp", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["203.0.113.9", "203.0.113.9"],
    ["1.1.1.1, 203.0.113.9", "203.0.113.9"],
    ["::ffff:203.0.113.9", "203.0.113.9"],
    ["2001:db8::1", "2001:db8::1"],
    ["1.1.1.1, not-an-ip", null],
  ])("%s -> %s", (xff, want) => {
    expect(clientIp(h(xff))).toBe(want);
  });
});
