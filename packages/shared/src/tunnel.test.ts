import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TUNNEL_CLOSE, TUNNEL_MAX_MESSAGE_BYTES, TUNNEL_SUBPROTOCOL } from "./tunnel";

// The Go package is the implementation; the mirror must not drift from it.
const goSource = readFileSync(join(import.meta.dir, "../../protocol/protocol.go"), "utf8");

function goConst(name: string): string {
  const line = goSource.split(/\r?\n/).find((l) => l.trim().startsWith(`${name} `));
  const match = line?.match(/=\s*([^/]+?)\s*(?:\/\/.*)?$/);
  if (!match?.[1]) throw new Error(`constant ${name} not found in protocol.go`);
  return match[1];
}

describe("tunnel protocol mirror", () => {
  it("matches the Go constants", () => {
    expect(goConst("Subprotocol")).toBe(`"${TUNNEL_SUBPROTOCOL}"`);
    expect(goConst("MaxMessageBytes")).toBe("1 << 20");
    expect(TUNNEL_MAX_MESSAGE_BYTES).toBe(1 << 20);
    const pairs: [string, number][] = [
      ["CloseInvalidMessage", TUNNEL_CLOSE.invalidMessage],
      ["CloseUnauthorized", TUNNEL_CLOSE.unauthorized],
      ["CloseUnknownEndpoint", TUNNEL_CLOSE.unknownEndpoint],
      ["CloseTooManyTunnels", TUNNEL_CLOSE.tooManyTunnels],
      ["CloseUnsupportedProtocol", TUNNEL_CLOSE.unsupportedProtocol],
      ["ClosePingTimeout", TUNNEL_CLOSE.pingTimeout],
      ["CloseLagging", TUNNEL_CLOSE.lagging],
    ];
    for (const [name, value] of pairs) expect(Number(goConst(name))).toBe(value);
  });
});
