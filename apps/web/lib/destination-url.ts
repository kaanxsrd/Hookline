import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Early, friendly validation of destination URLs. The worker re-checks every
 * address it dials (packages/gocommon/safehttp), so this is not the security
 * boundary — DNS can change between now and delivery — but it rejects
 * obviously internal targets when they are saved. Keep the ranges in sync
 * with safehttp.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

function expandIPv6(address: string): number[] {
  let addr = address;
  // Trailing dotted IPv4 (e.g. ::ffff:1.2.3.4).
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.split(".").map(Number);
    addr = `${addr.slice(0, -v4.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((g) => Number.parseInt(g, 16));
}

/** Whether a literal IP address may be dialed (mirrors safehttp.AllowedAddr). */
export function allowedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  const g = expandIPv6(address);
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  // IPv4-mapped (::ffff:a.b.c.d)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return allowedAddress(embedded(g[6] ?? 0, g[7] ?? 0));
  }
  // NAT64 (64:ff9b::/96)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return allowedAddress(embedded(g[6] ?? 0, g[7] ?? 0));
  }
  // 6to4 (2002::/16)
  if (g[0] === 0x2002) return allowedAddress(embedded(g[1] ?? 0, g[2] ?? 0));
  return !blocked.check(address, "ipv6");
}

export function allowedPort(port: number): boolean {
  return port === 80 || port === 443 || (port >= 1024 && port <= 65535);
}

export type Resolve = (host: string) => Promise<string[]>;

const systemResolve: Resolve = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Checks a destination URL. Returns an error message for the user, or null
 * when the URL is acceptable.
 */
export async function checkDestinationUrl(
  raw: string,
  options: { allowPrivate: boolean; resolve?: Resolve },
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, such as https://example.com/webhooks.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http and https URLs are supported.";
  }
  if (url.username || url.password) {
    return "Put credentials in a header instead of the URL.";
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!allowedPort(port)) return `Port ${port} is not allowed. Use 80, 443 or 1024–65535.`;
  if (options.allowPrivate) return null;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "Destinations cannot point at localhost. Use the Hookline CLI to forward to your machine.";
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await (options.resolve ?? systemResolve)(host);
    } catch {
      return `Could not resolve ${host}.`;
    }
  }
  if (addresses.length === 0) return `Could not resolve ${host}.`;
  if (!addresses.every(allowedAddress)) {
    return "Destinations cannot point at private, loopback or link-local addresses.";
  }
  return null;
}
