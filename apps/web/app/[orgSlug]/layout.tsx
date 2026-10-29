import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { api, load } from "@/lib/trpc/server";

export default async function OrgLayout({
  params,
  children,
}: {
  params: Promise<{ orgSlug: string }>;
  children: ReactNode;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(`/${orgSlug}`);
  const caller = await api();
  const [org, orgs] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    caller.org.mine(),
  ]);

  return (
    <AppShell
      org={{ slug: org.slug, name: org.name, role: org.role, plan: org.plan }}
      orgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
      appHost={new URL(env().APP_URL).host}
    >
      {children}
    </AppShell>
  );
}
