import { resolveAnonymousAccess } from "@/lib/anonymous";
import { bodyDownload } from "@/lib/body-download";
import { getDb } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/anonymous/{slug}/requests/{id}/body[?t=token] — a temporary endpoint's captured body. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const token = new URL(request.url).searchParams.get("t") ?? undefined;
  const access = UUID.test(id) ? await resolveAnonymousAccess(slug, token) : null;
  if (!access)
    return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  return bodyDownload(
    getDb(),
    { id: access.endpoint.id, slug, createdAt: access.endpoint.createdAt },
    id,
  );
}
