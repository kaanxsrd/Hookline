import { describe, expect, test } from "bun:test";
import { parseDuration, quantile, randomPrivateIp, summarize } from "./loadstats";

describe("quantile", () => {
  test("uses the nearest rank", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(xs, 0.5)).toBe(5);
    expect(quantile(xs, 0.9)).toBe(9);
    expect(quantile(xs, 0.99)).toBe(10);
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe("summarize", () => {
  test("counts statuses, errors and failures", () => {
    const s = summarize(
      [
        { status: 200, ms: 10 },
        { status: 200, ms: 20 },
        { status: 429, ms: 5 },
        { error: "timeout", ms: 1000 },
      ],
      2,
    );
    expect(s.total).toBe(4);
    expect(s.rps).toBe(2);
    expect(s.ok).toBe(2);
    expect(s.statuses).toEqual({ "200": 2, "429": 1 });
    expect(s.errors).toEqual({ timeout: 1 });
    expect(s.failureRate).toBe(0.5);
    expect(s.latency.max).toBe(1000);
    expect(s.latency.p50).toBe(10);
  });

  test("handles no outcomes", () => {
    expect(summarize([], 0)).toMatchObject({ total: 0, rps: 0, failureRate: 0 });
  });
});

describe("parseDuration", () => {
  test.each([
    ["30", 30_000],
    ["30s", 30_000],
    ["2m", 120_000],
    ["1500ms", 1500],
    ["0.5s", 500],
  ])("%s", (input, ms) => expect(parseDuration(input)).toBe(ms));

  test("rejects garbage", () => expect(() => parseDuration("soon")).toThrow());
});

test("randomPrivateIp stays in 10.0.0.0/8", () => {
  expect(randomPrivateIp(() => 0)).toBe("10.0.0.0");
  expect(randomPrivateIp(() => 0.999)).toBe("10.255.255.255");
});
