/**
 * Sensitive header detection. Captured webhooks carry credentials and
 * signatures; the dashboard and API mask these values unless explicitly
 * revealed (which is audit-logged).
 */

const SENSITIVE_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "apikey",
  "x-csrf-token",
]);

const SENSITIVE_FRAGMENTS = ["signature", "token", "secret", "hmac", "password"];

export const MASKED_VALUE = "••••••••";

/** Whether a header's value should be hidden by default. */
export function isSensitiveHeader(name: string): boolean {
  const n = name.toLowerCase();
  return SENSITIVE_NAMES.has(n) || SENSITIVE_FRAGMENTS.some((f) => n.includes(f));
}

/** Returns the pairs with sensitive values replaced by MASKED_VALUE. */
export function maskHeaders(pairs: readonly (readonly [string, string])[]): [string, string][] {
  return pairs.map(([name, value]) => [name, isSensitiveHeader(name) ? MASKED_VALUE : value]);
}
