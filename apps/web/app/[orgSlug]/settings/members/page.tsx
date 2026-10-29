import type { Metadata } from "next";
import { MembersSettings } from "./members-settings";

export const metadata: Metadata = {
  title: "Members",
  description: "Invite people and manage their roles.",
};

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return <MembersSettings orgSlug={orgSlug} />;
}
