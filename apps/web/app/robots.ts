import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Creating endpoints and private inboxes are never for crawlers.
      disallow: ["/new", "/e/", "/h/", "/api/"],
    },
  };
}
