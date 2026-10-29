import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasRole } from "@/lib/permissions";
import { api, load } from "@/lib/trpc/server";
import { AuditLogTable } from "./audit-log-table";

export const metadata: Metadata = {
  title: "Audit log",
  description: "Who changed what in the organization, and when.",
};

export default async function AuditLogPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const org = await load(async () => (await api()).org.current({ orgSlug }));
  if (!hasRole(org.role, "admin")) notFound();
  return <AuditLogTable orgSlug={orgSlug} />;
}
