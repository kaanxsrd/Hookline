import type { Metadata } from "next";
import { ApiKeysSettings } from "./api-keys-settings";

export const metadata: Metadata = {
  title: "API keys",
  description: "Keys for the REST API and the CLI.",
};

export default async function ApiKeysPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return <ApiKeysSettings orgSlug={orgSlug} />;
}
