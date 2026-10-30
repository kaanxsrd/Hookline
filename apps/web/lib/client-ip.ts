import { isIP } from "node:net";

/**
 * The header a hosting platform's proxy sets to the client address
 * (CLIENT_IP_HEADER, e.g. "x-real-ip" on Railway), or null to use
 * X-Forwarded-For. Read directly so Better Auth's config can use it too.
 */
export function clientIpHeader(): string | null {
  return process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || null;
}

function parse(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  const unmapped = v.startsWith("::ffff:") && isIP(v.slice(7)) === 4 ? v.slice(7) : v;
  return isIP(unmapped) ? unmapped : null;
}

/**
 * The client address of a request to the web app.
 *
 * With CLIENT_IP_HEADER set, that header wins: some platforms (Railway) end
 * X-Forwarded-For with their own edge server, but set a header of their own
 * to the client. Otherwise the app runs behind Caddy, which replaces
 * X-Forwarded-For with the address it received the connection from; Next.js
 * fills the header with the socket address only when it is absent. The
 * rightmost entry is therefore the closest trustworthy hop. The web app must
 * not be exposed to the internet without the proxy (see docs/deployment.md).
 */
export function clientIp(headers: Headers, header = clientIpHeader()): string | null {
  if (header) {
    const fromHeader = parse(headers.get(header)?.split(",")[0]);
    if (fromHeader) return fromHeader;
  }
  return parse(headers.get("x-forwarded-for")?.split(",").at(-1));
}
