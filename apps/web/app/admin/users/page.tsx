import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "Users" };

export default function AdminUsersPage() {
  return (
    <PageBody wide>
      <PageHeader title="Users" description="Every account on this instance." />
      <UsersTable />
    </PageBody>
  );
}
