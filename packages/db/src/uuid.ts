import { randomFillSync } from "node:crypto";

/**
 * Returns a UUIDv7 (RFC 9562) whose timestamp is `at`. Matches the SQL
 * uuidv7() function; useful when a row's ID must sort with a timestamp that
 * is not "now", such as backfilled or seeded requests.
 */
export function uuidv7(at: Date = new Date()): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes, 6);
  const ms = BigInt(at.getTime());
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
