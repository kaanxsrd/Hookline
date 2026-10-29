import { z } from "zod";
import { findEndpoint } from "@/lib/api/endpoints";
import { json, notFound, pageQuery, readQuery } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { listRequests } from "@/lib/requests";

const list = z.string().transform((s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

const query = pageQuery.extend({
  method: list
    .pipe(
      z
        .array(
          z
            .string()
            .toUpperCase()
            .regex(/^[A-Z]{1,16}$/),
        )
        .max(16),
    )
    .optional(),
  signature: list.pipe(z.array(z.enum(["verified", "invalid", "unchecked"])).max(3)).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(200).optional(),
});

/** An endpoint's requests, newest first. */
export const GET = apiRoute<{ id: string }>(
  "requests:read",
  async ({ request, caller: { db, org }, params }) => {
    const q = readQuery(request, query);
    const endpoint = await findEndpoint(db, org.id, params.id);
    if (!endpoint) throw notFound("endpoint");
    const result = await listRequests(db, endpoint, {
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.method ? { methods: q.method } : {}),
      ...(q.signature ? { signature: q.signature } : {}),
      ...(q.from ? { from: new Date(q.from).toISOString() } : {}),
      ...(q.to ? { to: new Date(q.to).toISOString() } : {}),
      ...(q.q ? { q: q.q } : {}),
    });
    return json({
      data: result.items.map((s) => ({
        id: s.id,
        endpoint_id: s.endpoint_id,
        method: s.method,
        path: s.path,
        content_type: s.content_type ?? null,
        body_size: s.body_size,
        source_ip: s.source_ip ?? null,
        signature_status: s.signature_status,
        response_status: s.response_status || null,
        received_at: s.received_at,
        deliveries: s.deliveries ?? [],
      })),
      next_cursor: result.nextCursor ?? null,
    });
  },
);
