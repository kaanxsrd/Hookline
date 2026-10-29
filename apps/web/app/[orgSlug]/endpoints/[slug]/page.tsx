import type { Metadata } from "next";
import { api, load } from "@/lib/trpc/server";
import { EndpointView } from "./endpoint-view";

type Props = {
  params: Promise<{ orgSlug: string; slug: string }>;
  searchParams: Promise<{ request?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, slug } = await params;
  const endpoint = await load(async () => (await api()).endpoint.get({ orgSlug, slug }));
  return { title: endpoint.name, description: `Live inbox of ${endpoint.name}.` };
}

export default async function EndpointPage({ params, searchParams }: Props) {
  const { orgSlug, slug } = await params;
  const { request } = await searchParams;
  return (
    <EndpointView
      orgSlug={orgSlug}
      slug={slug}
      selectedId={typeof request === "string" ? request : undefined}
    />
  );
}
