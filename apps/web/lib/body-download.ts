import "server-only";
import type { Db } from "@hookline/db";
import { type EndpointRef, getBodyRef } from "./requests";
import { streamBody } from "./s3";

const EXTENSIONS: [RegExp, string][] = [
  [/json/, "json"],
  [/xml/, "xml"],
  [/x-www-form-urlencoded/, "txt"],
  [/^text\//, "txt"],
  [/^image\/png/, "png"],
  [/^image\/jpe?g/, "jpg"],
  [/^application\/pdf/, "pdf"],
];

/**
 * A captured body as a download. Always application/octet-stream with
 * Content-Disposition: attachment, nosniff and a sandbox CSP, so a body can
 * never render as a page on the application's origin.
 */
export async function bodyDownload(db: Db, endpoint: EndpointRef, id: string): Promise<Response> {
  const ref = await getBodyRef(db, endpoint, id);
  if (!ref)
    return Response.json(
      { error: { code: "not_found", message: "Request not found." } },
      { status: 404 },
    );

  let body: BodyInit;
  if (ref.inline) body = Buffer.from(ref.inline);
  else if (ref.key) {
    const stream = await streamBody(ref.key);
    if (!stream) {
      return Response.json(
        { error: { code: "not_found", message: "The stored body is no longer available." } },
        { status: 404 },
      );
    }
    body = stream;
  } else body = new Uint8Array();

  const ext =
    EXTENSIONS.find(([re]) => re.test((ref.contentType ?? "").toLowerCase()))?.[1] ?? "bin";
  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="request-${id}.${ext}"`,
      "Content-Length": String(ref.size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
    },
  });
}
