import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelopes for secrets at rest; the twin of
 * packages/gocommon/secretbox (same format, shared test vector).
 *
 * DATA_ENCRYPTION_KEY is "kid:base64key[,kid:base64key...]": the first key
 * encrypts, all keys decrypt. Envelopes are
 * "hlenc:v1:<kid>:<base64url(nonce || ciphertext || tag)>", sealed with
 * associated data naming the secret's purpose and row.
 */

const PREFIX = "hlenc:v1:";
const NONCE = 12;
const TAG = 16;

type Key = { id: string; key: Buffer };

export function parseKeys(spec: string): Key[] {
  const keys = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const sep = item.indexOf(":");
      const id = item.slice(0, sep);
      const key = Buffer.from(item.slice(sep + 1), "base64");
      if (sep <= 0 || key.length !== 32) {
        throw new Error("DATA_ENCRYPTION_KEY must be kid:base64key with 32-byte keys");
      }
      return { id, key };
    });
  if (keys.length === 0) throw new Error("DATA_ENCRYPTION_KEY has no keys");
  return keys;
}

export function seal(
  keys: Key[],
  plaintext: string,
  context: string,
  nonce = randomBytes(NONCE),
): string {
  const active = keys[0];
  if (!active) throw new Error("no encryption key");
  const cipher = createCipheriv("aes-256-gcm", active.key, nonce);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${PREFIX}${active.id}:${Buffer.concat([nonce, body]).toString("base64url")}`;
}

export function open(keys: Key[], envelope: string, context: string): string {
  if (!envelope.startsWith(PREFIX)) throw new Error("cannot decrypt");
  const rest = envelope.slice(PREFIX.length);
  const sep = rest.indexOf(":");
  const key = keys.find((k) => k.id === rest.slice(0, sep));
  const sealed = Buffer.from(rest.slice(sep + 1), "base64url");
  if (!key || sep <= 0 || sealed.length < NONCE + TAG) throw new Error("cannot decrypt");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, sealed.subarray(0, NONCE));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
    return Buffer.concat([
      decipher.update(sealed.subarray(NONCE, sealed.length - TAG)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("cannot decrypt");
  }
}
