"use server";

import type { RequestDetail, RequestFilter, RequestPage } from "@/components/inbox/types";
import type { StreamAccess } from "@/components/inbox/use-request-stream";
import { resolveAnonymousAccess } from "@/lib/anonymous";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { getRequestDetail, listInputSchema, listRequests } from "@/lib/requests";
import { STREAM_TOKEN_TTL_SECONDS, signStreamToken } from "@/lib/stream-token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function access(slug: string, shareToken: string | undefined) {
  const result = await resolveAnonymousAccess(slug, shareToken);
  if (!result) throw new Error("Not found");
  const { id, createdAt } = result.endpoint;
  return { id, slug, createdAt };
}

/** A fresh stream token for an anonymous inbox the caller can read. */
export async function anonymousStreamAccess(
  slug: string,
  shareToken: string | undefined,
): Promise<StreamAccess> {
  const endpoint = await access(slug, shareToken);
  const { EDGE_PUBLIC_URL, STREAM_TOKEN_SECRET } = env();
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    url: `${EDGE_PUBLIC_URL}/v1/stream/${endpoint.id}`,
    token: signStreamToken(
      STREAM_TOKEN_SECRET,
      { sub: "anonymous", org: "", ep: endpoint.id },
      issuedAt,
    ),
    expiresAt: (issuedAt + STREAM_TOKEN_TTL_SECONDS) * 1000,
  };
}

export async function anonymousRequestList(
  slug: string,
  shareToken: string | undefined,
  filter: RequestFilter,
  cursor: string | undefined,
): Promise<RequestPage> {
  const endpoint = await access(slug, shareToken);
  const input = listInputSchema.parse({ ...filter, ...(cursor ? { cursor } : {}) });
  return listRequests(getDb(), endpoint, input);
}

/**
 * One captured request. Holders of the view token own the endpoint, so they
 * may reveal its sensitive headers; there is no organization audit log.
 */
export async function anonymousRequestDetail(
  slug: string,
  shareToken: string | undefined,
  requestId: string,
  reveal: boolean,
): Promise<RequestDetail | null> {
  if (!UUID.test(requestId)) return null;
  const endpoint = await access(slug, shareToken);
  return getRequestDetail(getDb(), endpoint, requestId, { reveal });
}
