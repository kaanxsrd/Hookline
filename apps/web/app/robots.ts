import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/site";

// Rendered per request so APP_URL comes from the running server, not the build.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Creating endpoints, private inboxes and administration are never for crawlers.
      disallow: ["/new", "/e/", "/h/", "/api/", "/admin"],
    },
    sitemap: publicUrl("/sitemap.xml"),
  };
}
