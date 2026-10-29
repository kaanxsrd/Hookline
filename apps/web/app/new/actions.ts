"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  authorizeAnonymous,
  createAnonymousEndpoint,
  parseVisitorCookie,
  VISITOR_COOKIE,
  visitorCookieValue,
} from "@/lib/anonymous";
import { clientIp } from "@/lib/client-ip";
import { secureCookies } from "@/lib/env";

export type CreateState = { error: string } | null;

/**
 * Creates the visitor's temporary endpoint (or reuses the live one they
 * already have: one per visitor) and opens its inbox.
 */
export async function createTemporaryEndpoint(): Promise<CreateState> {
  const jar = await cookies();
  const existing = parseVisitorCookie(jar.get(VISITOR_COOKIE)?.value);
  if (existing && (await authorizeAnonymous(existing.slug, existing.token))) {
    redirect(`/e/${existing.slug}`);
  }

  const result = await createAnonymousEndpoint(clientIp(await headers()));
  if (!result.ok) return { error: result.error };

  jar.set(VISITOR_COOKIE, visitorCookieValue(result.slug, result.token), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: result.expiresAt,
  });
  redirect(`/e/${result.slug}`);
}
