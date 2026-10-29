import { openapiDocument } from "@hookline/shared";
import { json } from "@/lib/api/http";
import { publicRoute } from "@/lib/api/route";

/** api/openapi.yaml as JSON. */
export const GET = publicRoute(async () =>
  json(openapiDocument, 200, { "Cache-Control": "public, max-age=300" }),
);
