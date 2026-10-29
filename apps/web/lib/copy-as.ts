/**
 * "Copy as" generators for a captured request. Hop-by-hop and
 * transport-specific headers are dropped; the body is included verbatim when
 * it is text, and replaced by a file reference when it is binary.
 */

export type CopyableRequest = {
  method: string;
  url: string;
  headers: [string, string][];
  /** The body as text, or null when it is binary or absent. */
  bodyText: string | null;
  hasBody: boolean;
};

const SKIP = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "accept-encoding",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "via",
]);

function headersToSend(headers: [string, string][]): [string, string][] {
  return headers.filter(([name]) => !SKIP.has(name.toLowerCase()));
}

/** POSIX shell single-quoting. */
function sh(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function toCurl(r: CopyableRequest): string {
  const parts = [`curl -X ${r.method} ${sh(r.url)}`];
  for (const [name, value] of headersToSend(r.headers)) parts.push(`-H ${sh(`${name}: ${value}`)}`);
  if (r.hasBody) {
    parts.push(r.bodyText !== null ? `--data-raw ${sh(r.bodyText)}` : "--data-binary @body.bin");
  }
  return parts.join(" \\\n  ");
}

export function toFetch(r: CopyableRequest): string {
  const init: string[] = [`  method: ${JSON.stringify(r.method)},`];
  const headers = headersToSend(r.headers);
  if (headers.length) {
    init.push("  headers: {");
    for (const [name, value] of headers)
      init.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
    init.push("  },");
  }
  if (r.hasBody) {
    init.push(
      r.bodyText !== null
        ? `  body: ${JSON.stringify(r.bodyText)},`
        : '  body: await (await import("node:fs/promises")).readFile("body.bin"),',
    );
  }
  return `await fetch(${JSON.stringify(r.url)}, {\n${init.join("\n")}\n});`;
}

export function toHttpie(r: CopyableRequest): string {
  const parts = [`http ${r.method} ${sh(r.url)}`];
  for (const [name, value] of headersToSend(r.headers)) parts.push(sh(`${name}:${value}`));
  if (!r.hasBody) return parts.join(" \\\n  ");
  return r.bodyText !== null
    ? `printf %s ${sh(r.bodyText)} | ${parts.join(" \\\n  ")}`
    : `${parts.join(" \\\n  ")} < body.bin`;
}
