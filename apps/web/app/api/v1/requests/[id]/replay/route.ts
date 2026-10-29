import { z } from "zod";
import { apiError, authenticate, json, readJson } from "@/lib/api/http";
import { requestEndpoint } from "@/lib/api/requests";
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

type Params = { params: Promise<{ id: string }> };

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
export async function POST(request: Request, { params }: Params) {
  const auth = await authenticate(request, "requests:replay");
  if ("response" in auth) return auth.response;
  const parsed = await readJson(request, body);
  if ("response" in parsed) return parsed.response;
  const { db, org, key } = auth.caller;
  const { id } = await params;

  const endpoint = await requestEndpoint(db, org.id, id);
  const captured = endpoint && (await loadCaptured(db, endpoint, id, MAX_EDIT_BODY_BYTES));
  if (!endpoint || !captured)
    return apiError(404, "not_found", "No such request in this organization.");

  const { target, override } = parsed.data;
  try {
    let edit: ReturnType<typeof resolveEdit> | undefined;
    if (override) {
      const e = editSchema.safeParse({
        method: override.method,
        path: override.path,
        query: override.query ?? "",
        headers: override.headers,
        ...(override.body_b64 !== undefined ? { bodyBase64: override.body_b64 } : {}),
      });
      if (!e.success) {
        return apiError(400, "invalid_request", "The override is invalid.", {
          fields: z.flattenError(e.error).fieldErrors,
        });
      }
      edit = resolveEdit(captured, e.data);
    }
    const result =
      target === "cli"
        ? { target: "cli", receivers: await replayToCli(captured, edit) }
        : {
            target: "destination",
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
      const status = error.code === "not_found" ? 404 : error.code === "no_tunnel" ? 409 : 400;
      return apiError(status, error.code, error.message);
    }
    throw error;
  }
}
