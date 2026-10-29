import "server-only";
import { type Db, schema } from "@hookline/db";
import { randomBase62, sha256 } from "./random";

/** Scopes an API key can carry (the database checks the same list). */
export const API_SCOPES = [
  "endpoints:read",
  "endpoints:write",
  "requests:read",
  "requests:replay",
  "tunnel",
  "destinations:write",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_KEY_PREFIX = "hk_live_";

/** A new key: "hk_live_" + 43 base62 characters (~256 bits). */
export function generateApiKey(): { key: string; prefix: string; hash: Buffer } {
  const key = API_KEY_PREFIX + randomBase62(43);
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 8), hash: sha256(key) };
}

/** Stores a new key and returns its plaintext once; only the hash is kept. */
export async function createApiKey(
  db: Pick<Db, "insert">,
  input: { orgId: string; createdBy: string | null; name: string; scopes: readonly ApiScope[] },
): Promise<{ id: string; key: string; prefix: string }> {
  const { key, prefix, hash } = generateApiKey();
  const [row] = await db
    .insert(schema.apiKey)
    .values({
      orgId: input.orgId,
      createdBy: input.createdBy,
      name: input.name,
      prefix,
      hash,
      scopes: [...input.scopes],
    })
    .returning({ id: schema.apiKey.id });
  if (!row) throw new Error("api key insert returned nothing");
  return { id: row.id, key, prefix };
}
