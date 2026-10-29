import { createHmac, createPublicKey, verify as edVerify, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature verification, the twin of packages/gocommon/signatures
 * (which verifies at capture time). The web app uses it to test a secret
 * against a captured request. Both are tested against
 * packages/shared/fixtures/signature-vectors.json.
 */

export const SIGNATURE_PROVIDERS = [
  "stripe",
  "github",
  "shopify",
  "slack",
  "standard_webhooks",
  "discord",
  "hmac_sha256",
] as const;
export type SignatureProvider = (typeof SIGNATURE_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<SignatureProvider, string> = {
  stripe: "Stripe",
  github: "GitHub",
  shopify: "Shopify",
  slack: "Slack",
  standard_webhooks: "Standard Webhooks (Svix)",
  discord: "Discord (Ed25519)",
  hmac_sha256: "Generic HMAC-SHA256",
};

/** What each provider calls the value to paste into Hookline. */
export const SECRET_LABELS: Record<SignatureProvider, string> = {
  stripe: "Endpoint signing secret (whsec_…)",
  github: "Webhook secret",
  shopify: "App client secret",
  slack: "Signing secret",
  standard_webhooks: "Signing secret (whsec_…)",
  discord: "Application public key (hex)",
  hmac_sha256: "Shared secret",
};

export const TOLERANCE_SECONDS = 300;

export type SignatureReason = "missing" | "malformed" | "timestamp" | "mismatch" | "secret";

export type SignatureResult =
  | { verified: true }
  | { verified: false; reason: SignatureReason; message: string };

export type SignatureInput = { headers: [string, string][]; body: Uint8Array; now: Date };

const ok: SignatureResult = { verified: true };
const fail = (reason: SignatureReason, message: string): SignatureResult => ({
  verified: false,
  reason,
  message,
});
const TOLERANCE_MSG = "The signed timestamp is more than 5 minutes from the time of capture.";

function header(input: SignatureInput, ...names: string[]): string {
  for (const name of names) {
    const found = input.headers.find(([k]) => k.toLowerCase() === name.toLowerCase());
    if (found) return found[1];
  }
  return "";
}

function hmac(key: Uint8Array | string, ...parts: (string | Uint8Array)[]): Buffer {
  const m = createHmac("sha256", key);
  for (const p of parts) m.update(p);
  return m.digest();
}

function equal(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

const HEX = /^[0-9a-fA-F]*$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

function fromHex(s: string): Buffer | null {
  return s.length % 2 === 0 && HEX.test(s) ? Buffer.from(s, "hex") : null;
}

function fromBase64(s: string): Buffer | null {
  return s.length % 4 === 0 && B64.test(s) ? Buffer.from(s, "base64") : null;
}

/** "within", "outside", or "invalid" for a Unix-seconds timestamp. */
function tolerance(ts: string, now: Date): "within" | "outside" | "invalid" {
  if (!/^-?\d+$/.test(ts.trim())) return "invalid";
  const delta = Math.abs(now.getTime() / 1000 - Number(ts.trim()));
  return delta <= TOLERANCE_SECONDS ? "within" : "outside";
}

function stripe(secret: string, input: SignatureInput): SignatureResult {
  const h = header(input, "Stripe-Signature");
  if (!h) return fail("missing", "The Stripe-Signature header is missing.");
  let ts = "";
  const sigs: string[] = [];
  for (const part of h.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v) ts = v;
    if (k === "v1" && v) sigs.push(v);
  }
  if (!ts || sigs.length === 0)
    return fail("malformed", "Stripe-Signature needs t= and v1= parts.");
  const t = tolerance(ts, input.now);
  if (t === "invalid") return fail("malformed", "Stripe-Signature has an invalid timestamp.");
  if (t === "outside") return fail("timestamp", TOLERANCE_MSG);
  const want = hmac(secret, `${ts}.`, input.body);
  for (const s of sigs) {
    const got = fromHex(s);
    if (got && equal(got, want)) return ok;
  }
  return fail("mismatch", "No v1 signature matches the body and signing secret.");
}

function hexHmac(
  secret: string,
  input: SignatureInput,
  name: string,
  prefix: string,
): SignatureResult {
  const h = header(input, name).trim();
  if (!h) return fail("missing", `The ${name} header is missing.`);
  if (!h.startsWith(prefix)) return fail("malformed", `${name} must start with ${prefix}.`);
  const got = fromHex(h.slice(prefix.length));
  if (!got) return fail("malformed", `${name} is not hex.`);
  return equal(got, hmac(secret, input.body))
    ? ok
    : fail("mismatch", "The signature does not match the body and secret.");
}

function shopify(secret: string, input: SignatureInput): SignatureResult {
  const h = header(input, "X-Shopify-Hmac-Sha256").trim();
  if (!h) return fail("missing", "The X-Shopify-Hmac-Sha256 header is missing.");
  const got = fromBase64(h);
  if (!got) return fail("malformed", "X-Shopify-Hmac-Sha256 is not base64.");
  return equal(got, hmac(secret, input.body))
    ? ok
    : fail("mismatch", "The signature does not match the body and secret.");
}

function slack(secret: string, input: SignatureInput): SignatureResult {
  const sig = header(input, "X-Slack-Signature");
  const ts = header(input, "X-Slack-Request-Timestamp");
  if (!sig || !ts)
    return fail("missing", "X-Slack-Signature and X-Slack-Request-Timestamp are required.");
  const t = tolerance(ts, input.now);
  if (t === "invalid")
    return fail("malformed", "X-Slack-Request-Timestamp is not a Unix timestamp.");
  if (t === "outside") return fail("timestamp", TOLERANCE_MSG);
  const got = sig.startsWith("v0=") ? fromHex(sig.slice(3)) : null;
  if (!got) return fail("malformed", "X-Slack-Signature must be v0= followed by hex.");
  return equal(got, hmac(secret, `v0:${ts.trim()}:`, input.body))
    ? ok
    : fail("mismatch", "The signature does not match the body and signing secret.");
}

function standardWebhooks(secret: string, input: SignatureInput): SignatureResult {
  const id = header(input, "webhook-id", "svix-id");
  const ts = header(input, "webhook-timestamp", "svix-timestamp");
  const sigs = header(input, "webhook-signature", "svix-signature");
  if (!id || !ts || !sigs) {
    return fail("missing", "webhook-id, webhook-timestamp and webhook-signature are required.");
  }
  const key = fromBase64(secret.replace(/^whsec_/, ""));
  if (!key || key.length === 0)
    return fail("secret", "The secret must be whsec_ followed by base64.");
  const t = tolerance(ts, input.now);
  if (t === "invalid") return fail("malformed", "webhook-timestamp is not a Unix timestamp.");
  if (t === "outside") return fail("timestamp", TOLERANCE_MSG);
  const want = hmac(key, `${id}.${ts.trim()}.`, input.body);
  for (const s of sigs.split(/\s+/)) {
    const [v, sig] = s.split(",", 2);
    const got = v === "v1" && sig ? fromBase64(sig) : null;
    if (got && equal(got, want)) return ok;
  }
  return fail("mismatch", "No v1 signature matches the body and secret.");
}

function discord(publicKey: string, input: SignatureInput): SignatureResult {
  const sig = header(input, "X-Signature-Ed25519");
  const ts = header(input, "X-Signature-Timestamp");
  if (!sig || !ts)
    return fail("missing", "X-Signature-Ed25519 and X-Signature-Timestamp are required.");
  const raw = fromHex(publicKey.trim());
  if (raw?.length !== 32) {
    return fail("secret", "Use your Discord application's public key (64 hex characters).");
  }
  const signature = fromHex(sig);
  if (signature?.length !== 64) {
    return fail("malformed", "X-Signature-Ed25519 is not a hex Ed25519 signature.");
  }
  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
    format: "jwk",
  });
  const valid = edVerify(null, Buffer.concat([Buffer.from(ts), input.body]), key, signature);
  return valid ? ok : fail("mismatch", "The Ed25519 signature does not match.");
}

const GENERIC_HEADERS = [
  "X-Signature",
  "X-Signature-256",
  "X-Hub-Signature-256",
  "X-Webhook-Signature",
  "X-Hmac-Signature",
];

function generic(secret: string, input: SignatureInput): SignatureResult {
  const h = header(input, ...GENERIC_HEADERS).trim();
  if (!h) return fail("missing", `None of ${GENERIC_HEADERS.join(", ")} is present.`);
  const sig = h.replace(/^sha256=/, "");
  const got = fromHex(sig) ?? fromBase64(sig);
  if (!got) return fail("malformed", "The signature is neither hex nor base64.");
  return equal(got, hmac(secret, input.body))
    ? ok
    : fail("mismatch", "The signature does not match the body and secret.");
}

export function verifySignature(
  provider: SignatureProvider,
  secret: string,
  input: SignatureInput,
): SignatureResult {
  switch (provider) {
    case "stripe":
      return stripe(secret, input);
    case "github":
      return hexHmac(secret, input, "X-Hub-Signature-256", "sha256=");
    case "shopify":
      return shopify(secret, input);
    case "slack":
      return slack(secret, input);
    case "standard_webhooks":
      return standardWebhooks(secret, input);
    case "discord":
      return discord(secret, input);
    case "hmac_sha256":
      return generic(secret, input);
  }
}
