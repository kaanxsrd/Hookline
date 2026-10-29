import { createHmac } from "node:crypto";

/**
 * Stream tokens authorize one browser tab to open the SSE stream of one
 * endpoint on the edge (services/edge/internal/streamauth verifies them).
 * Compact HS256 JWTs, five minutes long; claim order matches the Go side so
 * both produce identical tokens for identical input.
 */

export const STREAM_TOKEN_TTL_SECONDS = 5 * 60;
const AUDIENCE = "hookline-stream";

export type StreamClaims = {
  /** User ID, or "anonymous" for view-token holders. */
  sub: string;
  /** Organization ID, "" for anonymous endpoints. */
  org: string;
  /** Endpoint ID. */
  ep: string;
};

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function signStreamToken(
  secret: string,
  claims: StreamClaims,
  issuedAt = Math.floor(Date.now() / 1000),
): string {
  if (secret.length < 32) throw new Error("STREAM_TOKEN_SECRET must be at least 32 characters");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: claims.sub,
      org: claims.org,
      ep: claims.ep,
      aud: AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + STREAM_TOKEN_TTL_SECONDS,
    }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
