import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authorizeAnonymous, parseVisitorCookie, VISITOR_COOKIE } from "@/lib/anonymous";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/trpc/server";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = {
  title: "Get started",
  description: "Create your organization and your first webhook endpoint.",
  robots: { index: false },
};

export default async function OnboardingPage() {
  const session = await requireSession("/onboarding");
  const orgs = await (await api()).org.mine();

  const visitor = parseVisitorCookie((await cookies()).get(VISITOR_COOKIE)?.value);
  const temporary = visitor ? await authorizeAnonymous(visitor.slug, visitor.token) : null;

  // Onboarding is for people without an organization, or with a temporary endpoint to keep.
  if (orgs.length > 0 && !temporary) redirect(`/${orgs[0]?.slug}`);

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-12">
      <Link href="/" className="mb-10 text-lg font-semibold tracking-tight">
        Hookline
      </Link>
      <main className="w-full max-w-lg">
        <OnboardingWizard
          userName={session.user.name}
          appHost={new URL(env().APP_URL).host}
          existingOrgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))}
          temporarySlug={temporary?.slug ?? null}
        />
      </main>
    </div>
  );
}
