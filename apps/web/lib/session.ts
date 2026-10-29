import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";

/** The current session, read once per request. */
export const getSession = cache(async () => getAuth().api.getSession({ headers: await headers() }));

/** A signed-in, verified user, or a redirect to where they can become one. */
export async function requireSession(next: string) {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!session.user.emailVerified) {
    redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}`);
  }
  return session;
}
