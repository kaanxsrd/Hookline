/** Liveness probe for the web app, used by Docker, Caddy and the status page. */
export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
