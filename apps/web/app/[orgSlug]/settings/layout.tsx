import type { ReactNode } from "react";
import { PageBody, PageHeader } from "@/components/page-header";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({
  params,
  children,
}: {
  params: Promise<{ orgSlug: string }>;
  children: ReactNode;
}) {
  const { orgSlug } = await params;
  const org = await load(async () => (await api()).org.current({ orgSlug }));
  const tabs = [
    { href: `/${orgSlug}/settings/general`, label: "General" },
    { href: `/${orgSlug}/settings/members`, label: "Members" },
    ...(hasRole(org.role, "member")
      ? [{ href: `/${orgSlug}/settings/api-keys`, label: "API keys" }]
      : []),
    ...(hasRole(org.role, "admin")
      ? [
          { href: `/${orgSlug}/settings/billing`, label: "Billing" },
          { href: `/${orgSlug}/settings/audit-log`, label: "Audit log" },
        ]
      : []),
  ];
  return (
    <PageBody>
      <PageHeader title="Settings" description={org.name} />
      <SettingsNav tabs={tabs} />
      <div className="mt-8">{children}</div>
    </PageBody>
  );
}
