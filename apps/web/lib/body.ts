/**
 * Turns a captured body into something safe to display. Bodies are always
 * rendered as text (React escapes it); nothing is ever interpreted as HTML.
 */

export type BodyView =
  | { kind: "empty" }
  | { kind: "json"; text: string }
  | { kind: "text"; text: string }
  | { kind: "binary"; hex: string; truncated: boolean };

const HEX_PREVIEW_BYTES = 512;

export function describeBody(bytes: Uint8Array | null, contentType: string | null): BodyView {
  if (!bytes || bytes.length === 0) return { kind: "empty" };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return binary(bytes);
  }
  // Valid UTF-8 can still be binary (e.g. NUL-padded formats).
  if (hasControlCharacters(text)) return binary(bytes);

  const looksJson = /json/i.test(contentType ?? "") || /^\s*[[{]/.test(text);
  if (looksJson) {
    try {
      return { kind: "json", text: JSON.stringify(JSON.parse(text), null, 2) };
    } catch {
      // Not actually JSON; show it as text.
    }
  }
  return { kind: "text", text };
}

/** C0 control characters other than tab, newline, vertical tab, form feed and carriage return. */
function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && (c < 0x09 || c > 0x0d)) return true;
  }
  return false;
}

function binary(bytes: Uint8Array): BodyView {
  const shown = bytes.subarray(0, HEX_PREVIEW_BYTES);
  const lines: string[] = [];
  for (let offset = 0; offset < shown.length; offset += 16) {
    const row = shown.subarray(offset, offset + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(row, (b) =>
      b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".",
    ).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return { kind: "binary", hex: lines.join("\n"), truncated: bytes.length > HEX_PREVIEW_BYTES };
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
