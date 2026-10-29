import { openapiDocument } from "@hookline/shared";
import type { Metadata } from "next";
import { ApiReference } from "./api-reference";

export const metadata: Metadata = {
  title: "API reference",
  description: "The Hookline REST API: endpoints, requests, destinations, deliveries and the CLI.",
};

export default function ApiReferencePage() {
  return (
    <main className="min-h-dvh">
      <ApiReference spec={openapiDocument} />
    </main>
  );
}
