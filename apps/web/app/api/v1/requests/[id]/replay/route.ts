import { z } from "zod";
import { ApiError, json, notFound, readJson } from "@/lib/api/http";
import { requestEndpoint } from "@/lib/api/requests";
import { apiRoute } from "@/lib/api/route";
import { writeAudit } from "@/lib/audit";
import { loadCaptured } from "@/lib/captured";
import { clientIp } from "@/lib/client-ip";
import {
  editSchema,
  MAX_EDIT_BODY_BYTES,
  ReplayError,
  replayToCli,
  replayToDestination,
  resolveEdit,
} from "@/lib/replay";

const body = z.object({
  target: z.union([z.literal("cli"), z.object({ destination_id: z.uuid() })]),
  /** An edited request; masked header values are restored from the capture. */
  override: z
    .object({
      method: z.string(),
      path: z.string(),
      query: z.string().optional(),
      headers: z.array(z.tuple([z.string(), z.string()])),
      body_b64: z.string().optional(),
    })
    .optional(),
});

/** Sends a captured request again, to a destination or to the connected CLIs. */
export const POST = apiRoute<{ id: string }>(
  "requests:replay",
  async ({ request, caller: { db, org, key }, params }) => {
    const { target, override } = await readJson(request, body);
    const endpoint = await requestEndpoint(db, org.id, params.id);
    const captured = endpoint && (await loadCaptured(db, endpoint, params.id, MAX_EDIT_BODY_BYTES));
    if (!endpoint || !captured) throw notFound("request");

    let edit: ReturnType<typeof resolveEdit> | undefined;
    try {
      if (override) {
        const parsed = editSchema.safeParse({
          method: override.method,
          path: override.path,
          query: override.query ?? "",
          headers: override.headers,
          ...(override.body_b64 !== undefined ? { bodyBase64: override.body_b64 } : {}),
        });
        if (!parsed.success) {
          throw new ApiError(400, "invalid_request", "The override is invalid.", {
            fields: z.flattenError(parsed.error).fieldErrors,
          });
        }
        edit = resolveEdit(captured, parsed.data);
      }
      const result =
        target === "cli"
          ? { target: "cli" as const, receivers: await replayToCli(captured, edit) }
          : {
              target: "destination" as const,
              delivery_id: await replayToDestination(db, {
                orgId: org.id,
                endpointId: endpoint.id,
                requestId: captured.id,
                destinationId: target.destination_id,
                ...(edit ? { override: edit } : {}),
              }),
            };
      await writeAudit(db, {
        orgId: org.id,
        actorApiKeyId: key.id,
        action: "request.replayed",
        targetType: "request",
        targetId: captured.id,
        metadata: { to: result.target, edited: Boolean(override) },
        ip: clientIp(request.headers),
      });
      return json(result, 202);
    } catch (error) {
      if (error instanceof ReplayError) {
        throw new ApiError(
          error.code === "not_found" ? 404 : error.code === "no_tunnel" ? 409 : 400,
          error.code,
          error.message,
        );
      }
      throw error;
    }
  },
);
