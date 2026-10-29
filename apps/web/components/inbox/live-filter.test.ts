import { describe, expect, it } from "vitest";
import { matchesLive } from "./live-filter";
import type { RequestSummary } from "./types";

const req: RequestSummary = {
  id: "01890000-0000-7000-8000-000000000001",
  endpoint_id: "e",
  method: "POST",
  path: "/",
  body_size: 2,
  signature_status: "verified",
  response_status: 200,
  received_at: "2026-01-01T12:00:00.000Z",
};

describe("matchesLive", () => {
  it("admits everything without a filter", () => {
    expect(matchesLive(req, {})).toBe(true);
  });

  it.each([
    [{ methods: ["GET"] }, false],
    [{ methods: ["GET", "POST"] }, true],
    [{ signature: ["invalid" as const] }, false],
    [{ signature: ["verified" as const] }, true],
    [{ delivery: ["failed" as const] }, false],
    [{ delivery: ["none" as const] }, true],
    [{ q: "anything" }, false],
    [{ from: "2026-01-01T13:00:00.000Z" }, false],
    [{ to: "2026-01-01T11:00:00.000Z" }, false],
    [{ from: "2026-01-01T11:00:00.000Z", to: "2026-01-01T13:00:00.000Z" }, true],
  ])("%j -> %s", (filter, want) => {
    expect(matchesLive(req, filter)).toBe(want);
  });
});
