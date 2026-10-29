import { notFound } from "@/lib/api/http";
import { requestEndpoint } from "@/lib/api/requests";
import { apiRoute } from "@/lib/api/route";
import { bodyDownload } from "@/lib/body-download";

/** The raw body as an attachment, streamed from storage when large. */
export const GET = apiRoute<{ id: string }>(
  "requests:read",
  async ({ caller: { db, org }, params }) => {
    const endpoint = await requestEndpoint(db, org.id, params.id);
    if (!endpoint) throw notFound("request");
    return bodyDownload(db, endpoint, params.id);
  },
);
