import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { AdminAuditTable } from "./admin-audit-table";

export const metadata: Metadata = { title: "Audit log" };

export default function AdminAuditLogPage() {
  return (
    <PageBody wide>
      <PageHeader
        title="Audit log"
        description="What administrators did on this instance. Changes inside an organization are in its own audit log."
      />
      <AdminAuditTable />
    </PageBody>
  );
}
