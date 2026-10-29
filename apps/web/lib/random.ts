import { createHash, timingSafeEqual } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Uniformly random base62 string from crypto.getRandomValues. Bytes >= 248
 * are rejected so every character is equally likely (248 = 4 * 62).
 */
export function randomBase62(length: number): string {
  let out = "";
  // getRandomValues accepts at most 65,536 bytes per call.
  const buf = new Uint8Array(Math.min(length * 2, 4096));
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248) out += BASE62[b % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

/** An endpoint slug: 12 base62 characters (~71 bits). */
export function newSlug(): string {
  return randomBase62(12);
}

/** A bearer secret: 32 random bytes, base64url. */
export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time check of a presented secret against its stored SHA-256. */
export function matchesHash(presented: string, storedHash: Uint8Array | null | undefined): boolean {
  if (storedHash?.length !== 32) return false;
  return timingSafeEqual(sha256(presented), storedHash);
}
