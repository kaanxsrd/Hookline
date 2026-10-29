import { json } from "@/lib/api/http";
import { env } from "@/lib/env";

/** Where the CLI opens tunnels. Public: it reveals nothing beyond the instance's URLs. */
export function GET() {
  const edge = new URL(env().EDGE_PUBLIC_URL);
  edge.protocol = edge.protocol === "https:" ? "wss:" : "ws:";
  edge.pathname = "/v1/tunnel";
  return json({
    app_url: env().APP_URL,
    edge_url: env().EDGE_PUBLIC_URL,
    tunnel_url: edge.toString(),
    tunnel_protocol: "hookline.v1",
  });
}
