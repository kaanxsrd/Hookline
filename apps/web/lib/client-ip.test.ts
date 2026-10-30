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

describe("clientIp with a platform header", () => {
  const railway = new Headers({
    "x-forwarded-for": "212.60.107.194, 152.233.12.241",
    "x-real-ip": "212.60.107.194",
  });

  it("prefers the configured header", () => {
    expect(clientIp(railway, "x-real-ip")).toBe("212.60.107.194");
  });

  it("falls back to X-Forwarded-For when the header is missing or invalid", () => {
    const xff = new Headers({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "nope" });
    expect(clientIp(xff, "x-real-ip")).toBe("203.0.113.9");
  });

  it("ignores the header unless configured", () => {
    expect(clientIp(railway, null)).toBe("152.233.12.241");
  });
});
