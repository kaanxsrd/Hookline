import { apiError, authenticate, json } from "@/lib/api/http";
import { requestEndpoint } from "@/lib/api/requests";
import { loadCaptured } from "@/lib/captured";

type Params = { params: Promise<{ id: string }> };

/** Bodies up to this size are included; larger ones are fetched from /body. */
const MAX_INLINE_BODY = 10 * 1024 * 1024;

/** One captured request with headers (unmasked) and body. */
export async function GET(request: Request, { params }: Params) {
  const auth = await authenticate(request, "requests:read");
  if ("response" in auth) return auth.response;
  const { db, org } = auth.caller;
  const { id } = await params;
  const endpoint = await requestEndpoint(db, org.id, id);
  const captured = endpoint && (await loadCaptured(db, endpoint, id, MAX_INLINE_BODY));
  if (!endpoint || !captured)
    return apiError(404, "not_found", "No such request in this organization.");
  return json({
    id: captured.id,
    endpoint: { id: endpoint.id, slug: endpoint.slug },
    method: captured.method,
    path: captured.path,
    query: captured.query,
    headers: captured.headers,
    content_type: captured.contentType,
    body_size: captured.bodySize,
    body_b64: captured.body ? Buffer.from(captured.body).toString("base64") : null,
    body_omitted: captured.bodyOmitted,
    received_at: captured.receivedAt,
  });
}
