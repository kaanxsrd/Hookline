import type { components } from "./api.gen";

/** Schemas of api/openapi.yaml, e.g. ApiSchema<"Endpoint">. */
export type ApiSchema<K extends keyof components["schemas"]> = components["schemas"][K];
