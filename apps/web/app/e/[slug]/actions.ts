"use server";

import { schema } from "@hookline/db";
import { and, eq, gte } from "drizzle-orm";
import type { RequestDetail } from "@/components/inbox/types";
import type { StreamAccess } from "@/components/inbox/use-live-requests";
import { resolveAnonymousAccess } from "@/lib/anonymous";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { detailColumns, toDetail } from "@/lib/requests";
import { STREAM_TOKEN_TTL_SECONDS, signStreamToken } from "@/lib/stream-token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh stream token for an anonymous inbox the caller can read. */
export async function anonymousStreamAccess(
  slug: string,
  shareToken: string | undefined,
): Promise<StreamAccess> {
  const access = await resolveAnonymousAccess(slug, shareToken);
  if (!access) throw new Error("Not found");
  const { EDGE_PUBLIC_URL, STREAM_TOKEN_SECRET } = env();
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    url: `${EDGE_PUBLIC_URL}/v1/stream/${access.endpoint.id}`,
    token: signStreamToken(
      STREAM_TOKEN_SECRET,
      { sub: "anonymous", org: "", ep: access.endpoint.id },
      issuedAt,
    ),
    expiresAt: (issuedAt + STREAM_TOKEN_TTL_SECONDS) * 1000,
  };
}

/** One captured request, with sensitive headers masked. */
export async function anonymousRequestDetail(
  slug: string,
  shareToken: string | undefined,
  requestId: string,
): Promise<RequestDetail | null> {
  if (!UUID.test(requestId)) return null;
  const access = await resolveAnonymousAccess(slug, shareToken);
  if (!access) return null;
  const r = schema.request;
  const [row] = await getDb()
    .select(detailColumns)
    .from(r)
    .where(
      and(
        eq(r.id, requestId),
        eq(r.endpointId, access.endpoint.id),
        gte(r.receivedAt, access.endpoint.createdAt),
      ),
    );
  return row ? toDetail(row) : null;
}
