import type { MetadataRoute } from "next";
import { DOCS_PAGES } from "@/lib/docs-nav";
import { publicUrl } from "@/lib/site";

// Rendered per request so APP_URL comes from the running server, not the build.
export const dynamic = "force-dynamic";

const PAGES = ["/", "/pricing", "/changelog", "/security", "/privacy", "/terms", "/status"];

/** Public pages only; the app, inboxes and the API are never listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [...PAGES, ...DOCS_PAGES.map((p) => p.href)].map((path) => ({ url: publicUrl(path) }));
}
