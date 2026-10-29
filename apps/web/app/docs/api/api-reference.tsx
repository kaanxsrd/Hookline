"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

/** Scalar's interactive reference for api/openapi.yaml. */
export function ApiReference({ spec }: { spec: Record<string, unknown> }) {
  return (
    <ApiReferenceReact
      configuration={{
        content: spec,
        // Fonts and telemetry would load from third-party origins the CSP blocks.
        withDefaultFonts: false,
        telemetry: false,
        hideClientButton: true,
        servers: [{ url: "/api/v1", description: "This Hookline instance" }],
        authentication: { preferredSecurityScheme: "apiKey" },
      }}
    />
  );
}
