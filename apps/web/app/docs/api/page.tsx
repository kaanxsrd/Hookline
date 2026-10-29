import { openapiDocument } from "@hookline/shared";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/site-header";
import { ApiReference } from "./api-reference";

export const metadata: Metadata = {
  title: "API reference",
  description: "The Hookline REST API: endpoints, requests, destinations, deliveries and the CLI.",
};

export default function ApiReferencePage() {
  return (
    <>
      {/* Not sticky: Scalar's own sidebar sticks to the top of the viewport. */}
      <SiteHeader sticky={false} />
      <main className="min-h-dvh">
        <ApiReference spec={openapiDocument} />
      </main>
    </>
  );
}
