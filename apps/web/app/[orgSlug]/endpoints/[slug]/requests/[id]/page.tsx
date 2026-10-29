import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EndpointView } from "../../endpoint-view";

type Props = { params: Promise<{ orgSlug: string; slug: string; id: string }> };

export const metadata: Metadata = {
  title: "Request",
  description: "A captured webhook request.",
};

/** A shareable link to one request: the inbox with that request open. */
export default async function RequestPage({ params }: Props) {
  const { orgSlug, slug, id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <EndpointView orgSlug={orgSlug} slug={slug} selectedId={id} />;
}
