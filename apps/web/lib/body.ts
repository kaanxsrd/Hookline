/**
 * Turns captured bodies into views. Everything is rendered as text (React
 * escapes it); a body is never interpreted as HTML.
 */

export type BodyKind = "json" | "form" | "xml" | "text" | "binary" | "empty";

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** C0 control characters other than tab, newline, vertical tab, form feed and carriage return. */
function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && (c < 0x09 || c > 0x0d)) return true;
  }
  return false;
}

/** The body as text, or null when it is not valid, printable UTF-8. */
export function bodyText(bytes: Uint8Array): string | null {
  try {
    const text = strictUtf8.decode(bytes);
    return hasControlCharacters(text) ? null : text;
  } catch {
    return null;
  }
}

/** The best view for a body, from its bytes and content type. */
export function detectKind(bytes: Uint8Array, contentType: string | null | undefined): BodyKind {
  if (bytes.length === 0) return "empty";
  const text = bodyText(bytes);
  if (text === null) return "binary";
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json") || /^\s*[[{]/.test(text)) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      // Truncated or malformed: fall through.
    }
  }
  if (ct.includes("x-www-form-urlencoded")) return "form";
  if (ct.includes("xml") || /^\s*<\?xml|^\s*<[A-Za-z][\w:.-]*[\s>]/.test(text)) return "xml";
  return "text";
}

/** Form fields in order; repeated names are kept. */
export function parseForm(text: string): [string, string][] {
  return [...new URLSearchParams(text)];
}

/** Indents XML for reading. Only whitespace between tags changes. */
export function prettyXml(xml: string): string {
  const tokens = xml.replace(/>\s+</g, "><").split(/(?=<)|(?<=>)/);
  let depth = 0;
  const lines: string[] = [];
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    if (/^<\//.test(token)) depth = Math.max(0, depth - 1);
    lines.push(`${"  ".repeat(depth)}${token}`);
    if (/^<[^!?/][^>]*[^/]>$/.test(token) || /^<[A-Za-z][\w:.-]*>$/.test(token)) depth++;
  }
  // Put text content back on the line of its opening tag: <a>\n  text\n</a> -> <a>text</a>.
  return lines
    .join("\n")
    .replace(/(<([A-Za-z][\w:.-]*)[^>]*>)\n\s*([^<\n]+)\n\s*(<\/\2>)/g, "$1$3$4");
}

/** Classic 16-bytes-per-line hex dump with an ASCII column. */
export function hexDump(bytes: Uint8Array, max = 4096): { text: string; truncated: boolean } {
  const shown = bytes.subarray(0, max);
  const lines: string[] = [];
  for (let offset = 0; offset < shown.length; offset += 16) {
    const row = shown.subarray(offset, offset + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(row, (b) =>
      b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".",
    ).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return { text: lines.join("\n"), truncated: bytes.length > max };
}

/** 1536 -> "1.5 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
