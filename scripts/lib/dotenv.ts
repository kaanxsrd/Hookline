/**
 * Minimal .env parser shared by repository scripts. It supports what
 * .env.example uses: comments, optional `export`, bare values with trailing
 * comments, and single- or double-quoted values (double quotes expand \n).
 */
export function parseDotEnv(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rest = ""] = match;
    if (key === undefined) continue;

    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      const end = rest.indexOf(quote, 1);
      const inner = end === -1 ? rest.slice(1) : rest.slice(1, end);
      out[key] = quote === '"' ? inner.replaceAll("\\n", "\n") : inner;
      continue;
    }
    const comment = rest.search(/\s#/);
    out[key] = (comment === -1 ? rest : rest.slice(0, comment)).trim();
  }
  return out;
}
