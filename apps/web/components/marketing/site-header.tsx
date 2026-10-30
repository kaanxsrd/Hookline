import { getSession } from "@/lib/session";
import { SiteNavbar } from "./site-navbar";

/** Header of the marketing site and docs. Signed-in visitors get a way back to the app. */
export async function SiteHeader({ sticky = true }: { sticky?: boolean }) {
  const session = await getSession();
  return <SiteNavbar signedIn={Boolean(session?.user.emailVerified)} sticky={sticky} />;
}
