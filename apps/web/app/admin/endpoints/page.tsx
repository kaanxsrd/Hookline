import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { EndpointsTable } from "./endpoints-table";

export const metadata: Metadata = { title: "Endpoints" };

export default async function AdminEndpointsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  return (
    <PageBody wide>
      <PageHeader
        title="Endpoints"
        description="Find any endpoint by slug or name, including temporary ones, and disable abusive ones."
      />
      <EndpointsTable
        initialQuery={q ?? ""}
        initialStatus={status === "disabled" || status === "anonymous" ? status : "all"}
      />
    </PageBody>
  );
}
