import { isIP } from "node:net";

/**
 * The client address of a request to the web app.
 *
 * In production the app runs behind Caddy, which replaces X-Forwarded-For
 * with the address it received the connection from; Next.js fills the header
 * with the socket address only when it is absent. The rightmost entry is
 * therefore the closest trustworthy hop. The web app must not be exposed to
 * the internet without the proxy (see docs/deployment.md).
 */
export function clientIp(headers: Headers): string | null {
  const hops = headers.get("x-forwarded-for")?.split(",") ?? [];
  const last = hops.at(-1)?.trim();
  if (!last) return null;
  const unmapped = last.startsWith("::ffff:") && isIP(last.slice(7)) === 4 ? last.slice(7) : last;
  return isIP(unmapped) ? unmapped : null;
}
