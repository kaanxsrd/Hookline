import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { OrgsTable } from "./orgs-table";

export const metadata: Metadata = { title: "Organizations" };

export default function AdminOrganizationsPage() {
  return (
    <PageBody wide>
      <PageHeader title="Organizations" description="Every organization, its plan and its usage." />
      <OrgsTable />
    </PageBody>
  );
}
