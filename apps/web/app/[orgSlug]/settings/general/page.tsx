import type { Metadata } from "next";
import { env } from "@/lib/env";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { GeneralSettings } from "./general-settings";

export const metadata: Metadata = {
  title: "Organization settings",
  description: "Name, URL and deletion of the organization.",
};

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await load(async () => (await api()).org.current({ orgSlug }));
  return (
    <GeneralSettings
      org={{ slug: org.slug, name: org.name }}
      canEdit={hasRole(org.role, "admin")}
      canDelete={org.role === "owner"}
      appHost={new URL(env().APP_URL).host}
    />
  );
}
