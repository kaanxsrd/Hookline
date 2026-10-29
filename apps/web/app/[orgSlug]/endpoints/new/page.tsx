import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { NewEndpointForm } from "./new-endpoint-form";

export const metadata: Metadata = {
  title: "New endpoint",
  description: "Create a URL that captures every request sent to it.",
};

export default async function NewEndpointPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  return (
    <PageBody>
      <PageHeader
        title="New endpoint"
        description="A URL that captures every request sent to it."
      />
      <NewEndpointForm orgSlug={orgSlug} />
    </PageBody>
  );
}
