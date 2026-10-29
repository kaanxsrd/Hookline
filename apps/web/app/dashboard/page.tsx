import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/trpc/server";

/** Where "go to the app" lands: the first organization, or onboarding when there is none. */
export default async function DashboardRedirect() {
  await requireSession("/dashboard");
  const orgs = await (await api()).org.mine();
  redirect(orgs[0] ? `/${orgs[0].slug}` : "/onboarding");
}
