import "server-only";
import { env } from "./env";
import { open, parseKeys, seal } from "./secretbox";

let keys: ReturnType<typeof parseKeys> | undefined;

function activeKeys() {
  keys ??= parseKeys(env().DATA_ENCRYPTION_KEY);
  return keys;
}

/** Associated data binding a destination's signing secret to its row (matches the worker). */
export function destinationSigningContext(destinationId: string): string {
  return `destination.signing_secret:${destinationId}`;
}

/** Associated data binding an endpoint's signature secret to it (matches the edge). */
export function endpointSignatureContext(endpointId: string): string {
  return `endpoint.signature_secret:${endpointId}`;
}

export function sealSecret(plaintext: string, context: string): string {
  return seal(activeKeys(), plaintext, context);
}

export function openSecret(envelope: string, context: string): string {
  return open(activeKeys(), envelope, context);
}

/** A Standard Webhooks signing secret: "whsec_" + base64 of 32 random bytes. */
export function newSigningSecret(): string {
  return `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")}`;
}
